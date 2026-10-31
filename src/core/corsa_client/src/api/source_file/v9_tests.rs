//! Offline public-API controls over one genuine packet and explicitly synthetic corruptions.
use crate::{EncodedPayload, EncodedSourceFile, SourceFileHeader};

const PACKET: &[u8] = include_bytes!("fixtures/a183-protocol9.bin");
const EXPECTED: &str = include_str!("fixtures/a183-protocol9.expected.ts.txt");
const PROVENANCE: &str = include_str!("fixtures/a183-protocol9.provenance.json");

fn word(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

fn put(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn extended() -> usize {
    let root = word(PACKET, 40) as usize + 28;
    word(PACKET, 32) as usize + (word(PACKET, root + 20) & 0x00ff_ffff) as usize
}

fn refuses(label: &str, bytes: &[u8]) {
    assert!(
        EncodedSourceFile::decode(bytes).is_err(),
        "must refuse {label}"
    );
}

#[test]
fn genuine_v9_source_fields_match_the_independent_pre_api_source() {
    // These complete bytes were captured before any successful SDK decoding.
    let provenance: serde_json::Value = serde_json::from_str(PROVENANCE).unwrap();
    assert_eq!(PACKET.len(), 65_112);
    assert_eq!(EXPECTED.len(), 12_305);
    assert_eq!(provenance["run"], 41_236_399_939_u64);
    assert_eq!(
        provenance["fixture"]["sha256"],
        "def383ce807e96e4d0057a974a1ede1b3028cdb1a8fcac1502346bf48df00359"
    );
    assert_eq!(
        provenance["expected"]["sha256"],
        "d6864c51da6b6be62077051920cf94a87710351e7fe77bdfe263d14b4a397071"
    );
    assert_eq!(provenance["nativeAdmission"], false);
    let payload = EncodedPayload::new(PACKET.to_vec());
    assert_eq!(
        payload.source_file_header().unwrap(),
        SourceFileHeader {
            protocol_version: 9,
            source_file_id: Some(855),
            source_file_lease: Some(0),
            binder_data_offset: Some(0),
        }
    );
    let name = provenance["expected"]["fileName"].as_str().unwrap();
    assert_eq!(
        payload.decode_source_file().unwrap(),
        EncodedSourceFile {
            protocol_version: 9,
            file_name: name.to_owned(),
            path: name.to_owned(),
            text: EXPECTED.to_owned(),
            original_text: EXPECTED.to_owned(),
            language_variant: 0,
            script_kind: 3,
            content_mapping: None,
        }
    );
}

#[test]
fn v9_header_and_section_boundaries_refuse_malformed_payloads() {
    refuses("truncated owned header", &PACKET[..63]);
    let mut cases = Vec::new();
    for (label, offset, value) in [
        ("legacy-sized table start", 24, 44),
        ("descending string data", 28, 63),
        ("incomplete string pair table", 28, word(PACKET, 28) + 4),
        ("extended data beyond the payload", 32, u32::MAX),
        ("structured data beyond nodes", 36, word(PACKET, 40) + 1),
        ("nodes beyond the payload", 40, PACKET.len() as u32 + 1),
        ("missing root node", 40, PACKET.len() as u32 - 28),
        ("binder before nodes", 60, word(PACKET, 40) - 1),
        ("binder beyond payload", 60, PACKET.len() as u32 + 1),
        ("bounded but unqualified binder", 60, PACKET.len() as u32),
    ] {
        let mut bytes = PACKET.to_vec();
        put(&mut bytes, offset, value);
        cases.push((label, bytes));
    }
    for (label, bytes) in cases {
        refuses(label, &bytes);
        assert!(
            EncodedPayload::new(bytes).source_file_header().is_err(),
            "header must refuse {label}"
        );
    }
}

#[test]
fn v9_root_strings_and_structured_references_stay_in_their_regions() {
    let root_data = word(PACKET, 40) as usize + 28 + 20;
    let text = word(PACKET, extended());
    let first_pair = word(PACKET, 24) as usize + text as usize * 4;
    let mut cases = Vec::new();
    for (label, offset, value) in [
        ("root without extended data", root_data, 0),
        (
            "root extended data outside its section",
            root_data,
            0x80ff_ffff,
        ),
        ("odd string index", extended(), 1),
        ("out-of-range string index", extended(), u32::MAX),
        ("string beyond its data section", first_pair + 4, u32::MAX),
        (
            "structured reference beyond its section",
            extended() + 52,
            u32::MAX - 1,
        ),
    ] {
        let mut bytes = PACKET.to_vec();
        put(&mut bytes, offset, value);
        cases.push((label, bytes));
    }
    let mut reversed = PACKET.to_vec();
    put(&mut reversed, first_pair, 1);
    put(&mut reversed, first_pair + 4, 0);
    cases.push(("reversed string pair", reversed));
    for (label, bytes) in cases {
        refuses(label, &bytes);
    }
}

// The original legacy test encoder used this exact 44-byte header and body.
// These are synthetic bytes, not another captured producer packet.
fn legacy_packet(version: u8) -> Vec<u8> {
    let text = b"export const count: number = 1;\n";
    let mut bytes = Vec::new();
    for field in [
        u32::from(version) << 24,
        0,
        0,
        0,
        0,
        0,
        44,
        52,
        52 + text.len() as u32,
        128 + text.len() as u32,
        128 + text.len() as u32,
        0,
        text.len() as u32,
    ] {
        bytes.extend_from_slice(&field.to_le_bytes());
    }
    bytes.extend_from_slice(text);
    bytes.extend_from_slice(&[0; 76 + 28]);
    for field in [308_u32, 0, 0, 0, 0, 2 << 30, 0] {
        bytes.extend_from_slice(&field.to_le_bytes());
    }
    bytes
}

#[test]
fn legacy_absence_relabelled_44_byte_v9_and_future10_are_distinct() {
    for version in [7, 8] {
        let legacy = EncodedPayload::new(legacy_packet(version));
        assert_eq!(
            legacy.source_file_header().unwrap(),
            SourceFileHeader {
                protocol_version: version,
                source_file_id: None,
                source_file_lease: None,
                binder_data_offset: None,
            }
        );
    }
    refuses("legacy 44-byte layout relabelled9", &legacy_packet(9));
    let mut future = PACKET.to_vec();
    future[3] = 10;
    refuses("unqualified future protocol10", &future);
    assert!(EncodedPayload::new(future).source_file_header().is_err());
}

#[test]
fn opaque_u64_header_values_are_lossless_and_are_not_ownership_claims() {
    let mut bytes = PACKET.to_vec();
    bytes[44..52].copy_from_slice(&9_007_199_254_740_993_u64.to_le_bytes());
    bytes[52..60].copy_from_slice(&u64::MAX.to_le_bytes());
    let header = EncodedPayload::new(bytes).source_file_header().unwrap();
    assert_eq!(
        header.source_file_id.unwrap().to_string(),
        "9007199254740993"
    );
    assert_eq!(
        header.source_file_lease.unwrap().to_string(),
        "18446744073709551615"
    );
    assert_eq!(header.binder_data_offset, Some(0));
}

#[test]
fn the_existing_wtf8_lossy_string_policy_is_preserved() {
    let mut bytes = PACKET.to_vec();
    let text = word(PACKET, extended());
    let first_pair = word(PACKET, 24) as usize + text as usize * 4;
    let start = word(PACKET, 28) as usize + word(PACKET, first_pair) as usize;
    bytes[start..start + 3].copy_from_slice(&[0xed, 0xa0, 0x80]);
    let mut expected = EXPECTED.as_bytes().to_vec();
    expected[..3].copy_from_slice(&[0xed, 0xa0, 0x80]);
    let decoded = EncodedPayload::new(bytes).decode_source_file().unwrap();
    assert_eq!(
        decoded.text,
        String::from_utf8_lossy(&expected).into_owned()
    );
    assert_eq!(decoded.original_text, decoded.text);
}
