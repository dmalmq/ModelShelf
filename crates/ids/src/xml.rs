//! Minimal XML tree reader for IDS documents.
//!
//! IDS files are small and authoring tools disagree about namespace prefixes, so the
//! whole document is read into a tree keyed by **local** element names. That removes an
//! entire class of prefix bugs and keeps the facet interpretation readable.

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::IdsError;

#[derive(Debug, Clone, Default)]
pub struct Node {
    /// Local element name, lowercase (`specification`, `simplevalue`, `restriction`).
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub text: String,
    pub children: Vec<Node>,
}

impl Node {
    pub fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|c| c.name == name)
    }
    pub fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> + 'a {
        self.children.iter().filter(move |c| c.name == name)
    }
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
    /// Trimmed text of this node, `None` when empty.
    pub fn trimmed_text(&self) -> Option<&str> {
        let trimmed = self.text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    }
}

/// quick-xml 0.42 hands out `&str` payloads for string readers, so no lossy decoding is
/// needed here.
fn local_name(raw: &str) -> String {
    raw.rsplit(':').next().unwrap_or(raw).to_ascii_lowercase()
}

pub fn parse(xml: &str) -> Result<Node, IdsError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut root: Option<Node> = None;
    let mut stack: Vec<Node> = Vec::new();

    loop {
        match reader.read_event() {
            Err(err) => return Err(IdsError::Xml(err.to_string())),
            Ok(Event::Eof) => break,
            Ok(Event::Start(start)) => {
                let mut node = Node { name: local_name(start.name().as_ref()), ..Node::default() };
                collect_attributes(&start, &mut node)?;
                stack.push(node);
            }
            Ok(Event::Empty(start)) => {
                let mut node = Node { name: local_name(start.name().as_ref()), ..Node::default() };
                collect_attributes(&start, &mut node)?;
                match stack.last_mut() {
                    Some(parent) => parent.children.push(node),
                    None => root = Some(node),
                }
            }
            Ok(Event::End(_)) => {
                let Some(node) = stack.pop() else {
                    return Err(IdsError::Xml("unbalanced closing tag".into()));
                };
                match stack.last_mut() {
                    Some(parent) => parent.children.push(node),
                    None => root = Some(node),
                }
            }
            Ok(Event::Text(text)) => {
                if let Some(parent) = stack.last_mut() {
                    let decoded = quick_xml::escape::unescape(text.as_ref())
                        .map_err(|err| IdsError::Xml(err.to_string()))?
                        .into_owned();
                    parent.text.push_str(&decoded);
                }
            }
            Ok(Event::CData(data)) => {
                if let Some(parent) = stack.last_mut() {
                    parent.text.push_str(data.as_ref());
                }
            }
            Ok(_) => {}
        }
    }

    root.ok_or(IdsError::NotIds)
}

fn collect_attributes(
    start: &quick_xml::events::BytesStart<'_>,
    node: &mut Node,
) -> Result<(), IdsError> {
    for attr in start.attributes() {
        let attr = attr.map_err(|err| IdsError::Xml(err.to_string()))?;
        let key = local_name(attr.key.as_ref());
        let value = attr
            .unescape_value()
            .map_err(|err| IdsError::Xml(err.to_string()))?
            .into_owned();
        node.attrs.push((key, value));
    }
    Ok(())
}
