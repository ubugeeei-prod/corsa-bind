//! Content mapper bindings: source file decoding and span map queries.
//!
//! `getSourceFile` hands JavaScript the binary AST payload. These bindings turn
//! that payload into the source-file level record TypeScript's own API client
//! exposes — including the span map that maps checker positions in the virtual
//! TypeScript back into the file the user edits — without asking JavaScript to
//! reimplement the mapping rules.

use corsa::api::{
    ContentMapperDefinition, EncodedSourceFile, MappedPosition, MappedRange, SpanMap,
    SpanMapFeature, SpanMapSegment, TextRange,
};
use napi::{Result, bindgen_prelude::Uint8Array};
use napi_derive::napi;
use serde_json::Value;

use crate::util::{from_value, into_napi_error, to_value};

/// Decodes the source-file fields of a `getSourceFile` payload.
///
/// Throws when the payload is not an encoded source file, or when it was
/// produced by a binary protocol version this addon does not decode.
#[napi(js_name = "decodeSourceFile")]
pub fn decode_source_file(payload: Uint8Array) -> Result<Value> {
    let decoded = EncodedSourceFile::decode(payload.as_ref()).map_err(into_napi_error)?;
    to_value(&decoded)
}

/// Reports whether a `getSourceFile` payload came out of a content mapper.
///
/// Cheaper than decoding when a caller only needs to branch on it, and never
/// throws: an undecodable payload is simply not content mapped.
#[napi(js_name = "isContentMappedSourceFile")]
pub fn is_content_mapped_source_file(payload: Uint8Array) -> bool {
    EncodedSourceFile::decode(payload.as_ref())
        .map(|source_file| source_file.is_content_mapped())
        .unwrap_or(false)
}

/// Bidirectional mapping between a mapper's virtual text and the original file.
///
/// Every query takes an optional `feature` bitmask (see `SpanMapFeature`); when
/// omitted, all features are considered, which matches a segment that declared
/// no restriction.
#[napi]
pub struct CorsaSpanMap {
    inner: SpanMap,
}

/// Reads the content mappers a parsed `tsconfig` declares.
///
/// Accepts either a `parseConfigFile` response or the raw `tsconfig` object,
/// and returns an empty array when neither declares any.
#[napi(js_name = "contentMappersFromConfig")]
pub fn content_mappers_from_config(config: Value) -> Result<Value> {
    let raw = config.get("raw").unwrap_or(&config);
    let mappers = ContentMapperDefinition::from_raw_config(raw);
    to_value(&mappers)
}

/// Builds the span map of a `getSourceFile` payload.
///
/// Returns `null` when the file did not go through a content mapper, and throws
/// when the payload is not a source file this addon can decode.
#[napi(js_name = "spanMapForSourceFile")]
pub fn span_map_for_source_file(payload: Uint8Array) -> Result<Option<CorsaSpanMap>> {
    let decoded = EncodedSourceFile::decode(payload.as_ref()).map_err(into_napi_error)?;
    Ok(decoded.content_mapping.map(|mapping| CorsaSpanMap {
        inner: mapping.span_map,
    }))
}

#[napi]
impl CorsaSpanMap {
    /// Builds a span map from raw segments, as reported by `decodeSourceFile`.
    #[napi(factory, js_name = "fromSegments")]
    pub fn from_segments(segments: Value) -> Result<Self> {
        let segments: Vec<SpanMapSegment> = from_value(segments)?;
        Ok(Self {
            inner: SpanMap::new(segments),
        })
    }

    /// The segments, ordered by virtual start.
    #[napi(getter)]
    pub fn segments(&self) -> Result<Value> {
        to_value(&self.inner)
    }

    /// Number of segments in the map.
    #[napi(getter, js_name = "segmentCount")]
    pub fn segment_count(&self) -> u32 {
        self.inner.len() as u32
    }

    /// Maps a position in the virtual text back to the original file.
    #[napi(js_name = "virtualToOriginalPosition")]
    pub fn virtual_to_original_position(
        &self,
        position: u32,
        feature: Option<u32>,
    ) -> Result<Value> {
        let mapped = match feature {
            Some(feature) => self
                .inner
                .virtual_to_original_position_for_feature(position, SpanMapFeature(feature)),
            None => self.inner.virtual_to_original_position(position),
        };
        to_value(&mapped)
    }

    /// Maps a range in the virtual text back to the original file.
    #[napi(js_name = "virtualToOriginalSpan")]
    pub fn virtual_to_original_span(
        &self,
        pos: u32,
        end: u32,
        feature: Option<u32>,
    ) -> Result<Value> {
        let range = TextRange::new(pos, end);
        let mapped = match feature {
            Some(feature) => self
                .inner
                .virtual_to_original_span_for_feature(range, SpanMapFeature(feature)),
            None => self.inner.virtual_to_original_span(range),
        };
        to_value(&mapped)
    }

    /// Returns every projection of an original position into the virtual text.
    #[napi(js_name = "originalToVirtualPositions")]
    pub fn original_to_virtual_positions(
        &self,
        position: u32,
        feature: Option<u32>,
    ) -> Result<Value> {
        let projections: Vec<MappedPosition> = self.inner.original_to_virtual_positions(
            position,
            feature.map_or(SpanMapFeature::ALL, SpanMapFeature),
        );
        to_value(&projections)
    }

    /// Returns every projection of an original range into the virtual text.
    #[napi(js_name = "originalToVirtualSpans")]
    pub fn original_to_virtual_spans(
        &self,
        pos: u32,
        end: u32,
        feature: Option<u32>,
    ) -> Result<Value> {
        let projections: Vec<MappedRange> = self.inner.original_to_virtual_spans(
            TextRange::new(pos, end),
            feature.map_or(SpanMapFeature::ALL, SpanMapFeature),
        );
        to_value(&projections)
    }
}
