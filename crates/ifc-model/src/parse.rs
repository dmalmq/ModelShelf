//! STEP (ISO 10303-21) physical-file lexer and instance parser.
//!
//! Deliberately tolerant: IFC exports in the wild wrap instances across lines, embed
//! comments, and encode non-ASCII text through STEP escapes. Anything genuinely broken
//! becomes a `ParseError` — never a panic and never a silent truncation.

use std::collections::HashMap;

use crate::{Entity, Header, ParseError, SchemaId, Value};

pub struct ParsedFile {
    pub schema: SchemaId,
    pub header: Header,
    pub entities: HashMap<u32, Entity>,
}

pub fn parse_file(bytes: &[u8]) -> Result<ParsedFile, ParseError> {
    let mut lex = Lexer { b: bytes, pos: 0 };
    lex.expect_magic()?;

    let mut header = Header::default();
    let mut entities: HashMap<u32, Entity> = HashMap::with_capacity(1024);
    let mut schema: Option<SchemaId> = None;

    loop {
        lex.skip_trivia();
        match lex.peek() {
            None => break,
            Some(b';') => {
                lex.pos += 1;
            }
            Some(b'#') => {
                let (id, entity) = lex.parse_instance()?;
                entities.insert(id, entity);
            }
            Some(c) if is_ident_start(c) => {
                let kw = lex.parse_ident();
                match kw.as_str() {
                    "HEADER" => lex.eat_semicolon(),
                    "DATA" => {
                        // `DATA;` or `DATA(...);` (population form)
                        lex.skip_trivia();
                        if lex.peek() == Some(b'(') {
                            let _ = lex.parse_list()?;
                        }
                        lex.eat_semicolon();
                    }
                    "ENDSEC" => lex.eat_semicolon(),
                    "END-ISO-10303-21" => break,
                    "FILE_DESCRIPTION" | "FILE_NAME" | "FILE_SCHEMA" | "FILE_POPULATION"
                    | "SECTION_LANGUAGE" | "SECTION_CONTEXT" => {
                        let args = lex.parse_call_args()?;
                        apply_header_entry(&kw, &args, &mut header, &mut schema);
                        lex.eat_semicolon();
                    }
                    _ => {
                        // Unknown header function: consume its argument list if present.
                        lex.skip_trivia();
                        if lex.peek() == Some(b'(') {
                            let _ = lex.parse_list()?;
                        }
                        lex.eat_semicolon();
                    }
                }
            }
            Some(_) => {
                // Stray token: skip to the next statement rather than aborting the file.
                lex.skip_to_semicolon();
            }
        }
    }

    let schema = schema.ok_or(ParseError::MissingSchema)?;
    Ok(ParsedFile { schema, header, entities })
}

fn apply_header_entry(
    keyword: &str,
    args: &[Value],
    header: &mut Header,
    schema: &mut Option<SchemaId>,
) {
    let strings = |v: Option<&Value>| -> Vec<String> {
        match v {
            Some(Value::List(items)) => {
                items.iter().filter_map(|i| i.as_str().map(str::to_owned)).collect()
            }
            Some(Value::Str(s)) => vec![s.clone()],
            _ => Vec::new(),
        }
    };
    match keyword {
        "FILE_DESCRIPTION" => header.file_description = strings(args.first()),
        "FILE_NAME" => {
            header.file_name = args.first().and_then(Value::as_str).map(str::to_owned);
            header.time_stamp = args.get(1).and_then(Value::as_str).map(str::to_owned);
            header.authors = strings(args.get(2));
            header.organizations = strings(args.get(3));
            header.preprocessor_version = args.get(4).and_then(Value::as_str).map(str::to_owned);
            header.originating_system = args.get(5).and_then(Value::as_str).map(str::to_owned);
            header.authorization = args.get(6).and_then(Value::as_str).map(str::to_owned);
        }
        "FILE_SCHEMA" => {
            let tokens = strings(args.first());
            if let Some(first) = tokens.first() {
                *schema = Some(SchemaId::from_token(first));
            }
            header.schema_tokens = tokens;
        }
        _ => {}
    }
}

fn is_ident_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_'
}

fn is_ident_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'-'
}

struct Lexer<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Lexer<'a> {
    fn expect_magic(&mut self) -> Result<(), ParseError> {
        // Tolerate a UTF-8 BOM and leading whitespace before the magic token.
        if self.b.starts_with(&[0xEF, 0xBB, 0xBF]) {
            self.pos = 3;
        }
        self.skip_trivia();
        const MAGIC: &[u8] = b"ISO-10303-21";
        if self.b.len() < self.pos + MAGIC.len() || &self.b[self.pos..self.pos + MAGIC.len()] != MAGIC
        {
            return Err(ParseError::NotStepFile);
        }
        self.pos += MAGIC.len();
        self.skip_trivia();
        if self.peek() == Some(b';') {
            self.pos += 1;
        }
        Ok(())
    }

    fn peek(&self) -> Option<u8> {
        self.b.get(self.pos).copied()
    }

    fn skip_trivia(&mut self) {
        loop {
            match self.peek() {
                Some(c) if c.is_ascii_whitespace() => self.pos += 1,
                Some(b'/') if self.b.get(self.pos + 1) == Some(&b'*') => {
                    self.pos += 2;
                    while self.pos < self.b.len() {
                        if self.b[self.pos] == b'*' && self.b.get(self.pos + 1) == Some(&b'/') {
                            self.pos += 2;
                            break;
                        }
                        self.pos += 1;
                    }
                }
                _ => return,
            }
        }
    }

    fn eat_semicolon(&mut self) {
        self.skip_trivia();
        if self.peek() == Some(b';') {
            self.pos += 1;
        }
    }

    fn skip_to_semicolon(&mut self) {
        while let Some(c) = self.peek() {
            self.pos += 1;
            if c == b';' {
                return;
            }
        }
    }

    fn parse_ident(&mut self) -> String {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if is_ident_char(c) {
                self.pos += 1;
            } else {
                break;
            }
        }
        // Identifiers are ASCII by the standard; lossy conversion cannot lose data here.
        String::from_utf8_lossy(&self.b[start..self.pos]).to_ascii_uppercase()
    }

    fn parse_u32(&mut self) -> Result<u32, ParseError> {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() {
                self.pos += 1;
            } else {
                break;
            }
        }
        if start == self.pos {
            return Err(ParseError::Syntax {
                offset: self.pos,
                message: "expected instance id digits".into(),
            });
        }
        std::str::from_utf8(&self.b[start..self.pos])
            .ok()
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or(ParseError::Syntax { offset: start, message: "instance id overflow".into() })
    }

    /// `#12= IFCWALL(...);`
    fn parse_instance(&mut self) -> Result<(u32, Entity), ParseError> {
        debug_assert_eq!(self.peek(), Some(b'#'));
        self.pos += 1;
        let id = self.parse_u32()?;
        self.skip_trivia();
        if self.peek() != Some(b'=') {
            return Err(ParseError::Syntax {
                offset: self.pos,
                message: format!("expected '=' after #{id}"),
            });
        }
        self.pos += 1;
        self.skip_trivia();
        let entity = match self.peek() {
            Some(b'(') => {
                // Complex instance `#1=(A(..),B(..));` — keep the parts so nothing is lost.
                let parts = self.parse_call_args()?;
                Entity { id, ty: "COMPLEX".to_owned(), attrs: parts }
            }
            Some(c) if is_ident_start(c) => {
                let ty = self.parse_ident();
                let attrs = self.parse_call_args()?;
                Entity { id, ty, attrs }
            }
            _ => {
                return Err(ParseError::Syntax {
                    offset: self.pos,
                    message: format!("expected entity type for #{id}"),
                })
            }
        };
        self.eat_semicolon();
        Ok((id, entity))
    }

    fn parse_call_args(&mut self) -> Result<Vec<Value>, ParseError> {
        self.skip_trivia();
        match self.parse_list()? {
            Value::List(items) => Ok(items),
            other => Ok(vec![other]),
        }
    }

    fn parse_list(&mut self) -> Result<Value, ParseError> {
        self.skip_trivia();
        if self.peek() != Some(b'(') {
            return Err(ParseError::Syntax {
                offset: self.pos,
                message: "expected '('".into(),
            });
        }
        let open = self.pos;
        self.pos += 1;
        let mut items = Vec::new();
        loop {
            self.skip_trivia();
            match self.peek() {
                None => {
                    return Err(ParseError::Unterminated { construct: "list", offset: open });
                }
                Some(b')') => {
                    self.pos += 1;
                    return Ok(Value::List(items));
                }
                Some(b',') => {
                    self.pos += 1;
                }
                _ => items.push(self.parse_value()?),
            }
        }
    }

    fn parse_value(&mut self) -> Result<Value, ParseError> {
        self.skip_trivia();
        let c = self.peek().ok_or(ParseError::Unterminated { construct: "value", offset: self.pos })?;
        match c {
            b'$' => {
                self.pos += 1;
                Ok(Value::Null)
            }
            b'*' => {
                self.pos += 1;
                Ok(Value::Omitted)
            }
            b'#' => {
                self.pos += 1;
                Ok(Value::Ref(self.parse_u32()?))
            }
            b'\'' => Ok(Value::Str(self.parse_string()?)),
            b'"' => Ok(Value::Str(self.parse_binary_literal()?)),
            b'(' => self.parse_list(),
            b'.' => self.parse_dotted(),
            b'-' | b'+' | b'0'..=b'9' => self.parse_number(),
            c if is_ident_start(c) => {
                let name = self.parse_ident();
                self.skip_trivia();
                if self.peek() == Some(b'(') {
                    let mut args = self.parse_call_args()?;
                    let value = if args.len() == 1 {
                        args.remove(0)
                    } else {
                        Value::List(args)
                    };
                    Ok(Value::Typed { name, value: Box::new(value) })
                } else {
                    // Bare keyword where a value was expected (e.g. a truncated file).
                    Err(ParseError::Syntax {
                        offset: self.pos,
                        message: format!("unexpected keyword `{name}` in value position"),
                    })
                }
            }
            other => Err(ParseError::Syntax {
                offset: self.pos,
                message: format!("unexpected byte 0x{other:02X} in value position"),
            }),
        }
    }

    fn parse_dotted(&mut self) -> Result<Value, ParseError> {
        let start = self.pos;
        self.pos += 1; // leading '.'
        let token_start = self.pos;
        while let Some(c) = self.peek() {
            if c == b'.' {
                break;
            }
            if !is_ident_char(c) {
                return Err(ParseError::Syntax {
                    offset: self.pos,
                    message: "invalid character in enumeration token".into(),
                });
            }
            self.pos += 1;
        }
        if self.peek() != Some(b'.') {
            return Err(ParseError::Unterminated { construct: "enumeration", offset: start });
        }
        let token = String::from_utf8_lossy(&self.b[token_start..self.pos]).to_ascii_uppercase();
        self.pos += 1; // trailing '.'
        Ok(match token.as_str() {
            "T" => Value::Bool(true),
            "F" => Value::Bool(false),
            "U" => Value::Logical(None),
            _ => Value::Enum(token),
        })
    }

    fn parse_number(&mut self) -> Result<Value, ParseError> {
        let start = self.pos;
        let mut is_real = false;
        if matches!(self.peek(), Some(b'+') | Some(b'-')) {
            self.pos += 1;
        }
        while let Some(c) = self.peek() {
            match c {
                b'0'..=b'9' => self.pos += 1,
                b'.' => {
                    is_real = true;
                    self.pos += 1;
                }
                b'e' | b'E' => {
                    is_real = true;
                    self.pos += 1;
                    if matches!(self.peek(), Some(b'+') | Some(b'-')) {
                        self.pos += 1;
                    }
                }
                _ => break,
            }
        }
        let text = std::str::from_utf8(&self.b[start..self.pos])
            .map_err(|_| ParseError::Encoding { offset: start })?;
        if is_real {
            text.parse::<f64>().map(Value::Real).map_err(|_| ParseError::Syntax {
                offset: start,
                message: format!("invalid real `{text}`"),
            })
        } else {
            match text.parse::<i64>() {
                Ok(i) => Ok(Value::Int(i)),
                // Integers wider than i64 still carry information; keep them as reals.
                Err(_) => text.parse::<f64>().map(Value::Real).map_err(|_| ParseError::Syntax {
                    offset: start,
                    message: format!("invalid integer `{text}`"),
                }),
            }
        }
    }

    fn parse_binary_literal(&mut self) -> Result<String, ParseError> {
        let open = self.pos;
        self.pos += 1;
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c == b'"' {
                let text = String::from_utf8_lossy(&self.b[start..self.pos]).into_owned();
                self.pos += 1;
                return Ok(text);
            }
            self.pos += 1;
        }
        Err(ParseError::Unterminated { construct: "binary literal", offset: open })
    }

    fn parse_string(&mut self) -> Result<String, ParseError> {
        let open = self.pos;
        self.pos += 1; // opening quote
        let start = self.pos;
        loop {
            match self.peek() {
                None => return Err(ParseError::Unterminated { construct: "string", offset: open }),
                Some(b'\'') => {
                    // `''` is an escaped quote, not the terminator.
                    if self.b.get(self.pos + 1) == Some(&b'\'') {
                        self.pos += 2;
                        continue;
                    }
                    let raw = &self.b[start..self.pos];
                    self.pos += 1;
                    return Ok(decode_step_string(raw));
                }
                Some(b'\\') => {
                    // Only `\S\x` hides an arbitrary payload byte that could itself be a
                    // quote; every other escape payload is hex digits, so advancing one
                    // byte at a time is safe — and, unlike a fixed two-byte skip, it
                    // cannot step over the closing quote after a `\X2\..\X0\` run.
                    if self.b[self.pos..].starts_with(b"\\S\\") {
                        self.pos += 4;
                    } else {
                        self.pos += 1;
                    }
                }
                Some(_) => self.pos += 1,
            }
        }
    }
}

/// Decode STEP string escapes into a Rust `String`.
///
/// Handles `''`, `\\`, `\S\x` (ISO 8859-1 high half), `\X\hh`, `\X2\hhhh..\X0\` (UTF-16BE)
/// and `\X4\hhhhhhhh..\X0\` (UTF-32). Unknown escapes are kept verbatim rather than
/// dropped: silently losing characters from a client's model would be worse than an
/// odd-looking name. Raw bytes are treated as ISO 8859-1, which is what exporters emit
/// when they do not escape at all.
pub fn decode_step_string(raw: &[u8]) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        let c = raw[i];
        if c == b'\'' && raw.get(i + 1) == Some(&b'\'') {
            out.push('\'');
            i += 2;
            continue;
        }
        if c != b'\\' {
            out.push(c as char);
            i += 1;
            continue;
        }
        // Escape sequences all look like `\<code>\`.
        let rest = &raw[i + 1..];
        if rest.first() == Some(&b'\\') {
            out.push('\\');
            i += 2;
            continue;
        }
        let close = rest.iter().position(|&b| b == b'\\');
        let Some(close) = close else {
            out.push('\\');
            i += 1;
            continue;
        };
        let code = String::from_utf8_lossy(&rest[..close]).to_ascii_uppercase();
        let payload_start = i + 1 + close + 1;
        match code.as_str() {
            "S" => {
                if let Some(&b) = raw.get(payload_start) {
                    out.push((b as u32 + 128) as u8 as char);
                    i = payload_start + 1;
                } else {
                    i = payload_start;
                }
            }
            "X" => {
                if let Some(byte) = hex_byte(raw.get(payload_start..payload_start + 2)) {
                    out.push(byte as char);
                    i = payload_start + 2;
                } else {
                    out.push_str("\\X\\");
                    i = payload_start;
                }
            }
            "X2" | "X4" => {
                let width = if code == "X2" { 4 } else { 8 };
                let (text, next) = decode_wide_run(raw, payload_start, width);
                out.push_str(&text);
                i = next;
            }
            "X0" => {
                i = payload_start;
            }
            other => {
                // `\P?\` (code page directive) and friends carry no text.
                if other.starts_with('P') {
                    i = payload_start;
                } else {
                    out.push('\\');
                    out.push_str(other);
                    out.push('\\');
                    i = payload_start;
                }
            }
        }
    }
    out
}

fn hex_byte(slice: Option<&[u8]>) -> Option<u8> {
    let s = slice?;
    if s.len() != 2 {
        return None;
    }
    let hi = (s[0] as char).to_digit(16)?;
    let lo = (s[1] as char).to_digit(16)?;
    Some((hi * 16 + lo) as u8)
}

/// Decode a `\X2\`/`\X4\` run of hex code units up to the terminating `\X0\`.
fn decode_wide_run(raw: &[u8], mut pos: usize, width: usize) -> (String, usize) {
    let mut units: Vec<u32> = Vec::new();
    while pos + width <= raw.len() {
        let chunk = &raw[pos..pos + width];
        if !chunk.iter().all(|b| (*b as char).is_ascii_hexdigit()) {
            break;
        }
        let text = String::from_utf8_lossy(chunk);
        match u32::from_str_radix(&text, 16) {
            Ok(v) => units.push(v),
            Err(_) => break,
        }
        pos += width;
    }
    // Consume the `\X0\` terminator when present.
    if raw[pos..].starts_with(b"\\X0\\") {
        pos += 4;
    }
    let text = if width == 4 {
        String::from_utf16_lossy(&units.iter().map(|u| *u as u16).collect::<Vec<u16>>())
    } else {
        units.iter().filter_map(|u| char::from_u32(*u)).collect()
    };
    (text, pos)
}
