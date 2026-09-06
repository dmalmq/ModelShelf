//! Content hashing shared by revision ingestion (`sources.rs`) and blob verification
//! (`state.rs`). Revision ingestion itself lives in `sources.rs`: a revision belongs
//! to a source model, not a delivery, so it has nothing to do with an upload "to a
//! delivery" the way this module's name might suggest from its earlier shape.

use sha2::{Digest, Sha256};

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}
