//! Version-specific source-file headers; no AST or binder payload decoding.
use super::{
    EXT_SOURCE_FILE_SIZE, EncodedPayload, MAX_SOURCE_FILE_PROTOCOL_VERSION,
    MIN_SOURCE_FILE_PROTOCOL_VERSION, NODE_DATA_PAYLOAD_MASK, NODE_DATA_TYPE_EXTENDED,
    NODE_DATA_TYPE_MASK, NODE_OFFSET_DATA, NODE_SIZE, protocol, read_u32,
};
use crate::Result;

/// Header values are opaque metadata, not snapshot or symbol authority.
///
/// Ownership fields are absent on versions 7/8. Version-9 zero values remain
/// present. This type deliberately has no JSON serialization that could round
/// u64 IDs through a JavaScript number.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SourceFileHeader {
    /// Protocol of this source-file metadata payload, not a full AST capability.
    pub protocol_version: u8,
    /// Opaque file identifier; absent on versions 7/8, possibly zero on version 9.
    pub source_file_id: Option<u64>,
    /// Opaque lease identifier; zero is valid for snapshot-owned source files.
    pub source_file_lease: Option<u64>,
    /// Present only in version 9; this reader currently refuses nonzero values.
    pub binder_data_offset: Option<u32>,
}

impl EncodedPayload {
    /// Reads versioned header metadata without interpreting symbol ownership.
    ///
    /// Legacy fields are absent; present version-9 zero values remain `Some(0)`.
    /// IDs and leases are opaque u64 values, not proof of a live snapshot.
    pub fn source_file_header(&self) -> Result<SourceFileHeader> {
        read(self.as_bytes()).map(|header| header.metadata)
    }
}

pub(super) struct Header {
    pub(super) metadata: SourceFileHeader,
    pub(super) string_offsets: usize,
    pub(super) string_data: usize,
    pub(super) extended_data: usize,
    pub(super) structured_data: usize,
    pub(super) nodes: usize,
}

pub(super) fn read(payload: &[u8]) -> Result<Header> {
    let minimum = 44;
    if payload.len() < minimum {
        return Err(protocol(format_args!(
            "encoded source file is {} bytes, shorter than the {minimum} byte header",
            payload.len()
        )));
    }
    let version = payload[3];
    let header_size = match version {
        7 | 8 => 44,
        9 => 64,
        _ => {
            return Err(protocol(format_args!(
                "unsupported encoded source file protocol version {version} (this build decodes source-file metadata versions {MIN_SOURCE_FILE_PROTOCOL_VERSION} through {MAX_SOURCE_FILE_PROTOCOL_VERSION})"
            )));
        }
    };
    if payload.len() < header_size {
        return Err(protocol(format_args!(
            "encoded source file is {} bytes, shorter than the {header_size} byte version-{version} header",
            payload.len()
        )));
    }
    let string_offsets = read_u32(payload, 24)? as usize;
    let string_data = read_u32(payload, 28)? as usize;
    let extended_data = read_u32(payload, 32)? as usize;
    let structured_data = read_u32(payload, 36)? as usize;
    let nodes = read_u32(payload, 40)? as usize;
    if !(string_offsets <= string_data
        && string_data <= extended_data
        && extended_data <= structured_data
        && structured_data <= nodes
        && nodes <= payload.len())
    {
        return Err(protocol(format_args!(
            "encoded source file sections are out of order or out of bounds: {string_offsets}, {string_data}, {extended_data}, {structured_data}, {nodes} in {} bytes",
            payload.len()
        )));
    }
    let (source_file_id, source_file_lease, binder_data_offset) = if version == 9 {
        if string_offsets < header_size || (string_data - string_offsets) % 8 != 0 {
            return Err(protocol(format_args!(
                "invalid version-9 header/string-offset boundary"
            )));
        }
        let binder = read_u32(payload, 60)?;
        if binder != 0 {
            if (binder as usize) < nodes || (binder as usize) > payload.len() {
                return Err(protocol(format_args!(
                    "version-9 binder offset is outside the node region"
                )));
            }
            return Err(protocol(format_args!(
                "nonzero version-9 binder data is not supported"
            )));
        }
        if payload.len() - nodes < NODE_SIZE * 2 || (payload.len() - nodes) % NODE_SIZE != 0 {
            return Err(protocol(format_args!("invalid version-9 root/node region")));
        }
        (
            Some(read_u64(payload, 44)?),
            Some(read_u64(payload, 52)?),
            Some(binder),
        )
    } else {
        (None, None, None)
    };
    Ok(Header {
        metadata: SourceFileHeader {
            protocol_version: version,
            source_file_id,
            source_file_lease,
            binder_data_offset,
        },
        string_offsets,
        string_data,
        extended_data,
        structured_data,
        nodes,
    })
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64> {
    bytes
        .get(offset..offset + 8)
        .and_then(|value| value.try_into().ok())
        .map(u64::from_le_bytes)
        .ok_or_else(|| protocol(format_args!("incomplete u64 header field at {offset}")))
}

pub(super) fn source_data(
    payload: &[u8],
    nodes: usize,
    extended: usize,
    structured: usize,
) -> Result<&[u8]> {
    let root = nodes
        .checked_add(NODE_SIZE)
        .ok_or_else(|| protocol(format_args!("version-9 root offset overflow")))?;
    if root
        .checked_add(NODE_SIZE)
        .is_none_or(|end| end > payload.len())
    {
        return Err(protocol(format_args!(
            "version-9 root record is outside the node region"
        )));
    }
    let data = read_u32(payload, root + NODE_OFFSET_DATA)?;
    if data & NODE_DATA_TYPE_MASK != NODE_DATA_TYPE_EXTENDED {
        return Err(protocol(format_args!(
            "version-9 root has no source-file extended data"
        )));
    }
    let start = extended
        .checked_add((data & NODE_DATA_PAYLOAD_MASK) as usize)
        .ok_or_else(|| protocol(format_args!("version-9 extended-data offset overflow")))?;
    let end = start
        .checked_add(EXT_SOURCE_FILE_SIZE)
        .ok_or_else(|| protocol(format_args!("version-9 extended-data size overflow")))?;
    payload
        .get(start..end)
        .filter(|_| end <= structured)
        .ok_or_else(|| {
            protocol(format_args!(
                "version-9 source-file record crosses the extended-data boundary"
            ))
        })
}

pub(super) fn string_bytes(
    payload: &[u8],
    offsets: usize,
    strings: usize,
    extended: usize,
    index: u32,
) -> Result<&[u8]> {
    let entry = (index as usize)
        .checked_mul(4)
        .and_then(|offset| offsets.checked_add(offset));
    let entry = entry
        .filter(|entry| index % 2 == 0 && entry.checked_add(8).is_some_and(|end| end <= strings))
        .ok_or_else(|| {
            protocol(format_args!(
                "version-9 string {index} has no complete offsets pair"
            ))
        })?;
    let start = strings
        .checked_add(read_u32(payload, entry)? as usize)
        .ok_or_else(|| protocol(format_args!("version-9 string start overflow")))?;
    let end = strings
        .checked_add(read_u32(payload, entry + 4)? as usize)
        .ok_or_else(|| protocol(format_args!("version-9 string end overflow")))?;
    if start > end || end > extended {
        return Err(protocol(format_args!(
            "version-9 string {index} is outside the string-data region"
        )));
    }
    payload.get(start..end).ok_or_else(|| {
        protocol(format_args!(
            "version-9 string {index} is outside the payload"
        ))
    })
}
