# Text output

In **Connections & settings → Text output**, choose a profile, save it, then use **Datasets → Text output**. Preferences persist across restarts and apply to subsequent exports. They do not rewrite collected records or original files. Existing datasets can be exported again with different profiles without downloading them again.

## Formats

| Choice | Output |
| --- | --- |
| Extracted plain text | Title, source URL, and full extracted text for each record, separated by document markers. |
| Markdown documents | Titles and source links with extracted text in fenced blocks. Preserves code and literal Markdown without claiming to reconstruct the original document layout. |
| LaTeX source only | Actual `.tex` source from saved files, ZIP, tar, or gzip-compressed tar archives (including single gzipped manuscripts with recognizable LaTeX document syntax). Files are joined with filename comments. Records without `.tex` source are skipped and counted in the manifest; if none exist, export fails without overwriting an existing destination. |
| Preserve source files | Unchanged original attachments plus a UTF-8 JSONL index containing record metadata, provenance, and attachment paths. Omits the generated top-level extracted text. Encoding, normalization, BOM, line ending, and compression controls do not apply. |

LaTeX export produces a source corpus, not a newly generated compilable paper. Original archives remain available beside it, including figures, bibliography, and supporting files. Unsupported legacy source encodings cause a clear error; choose preserve source files to retain their exact bytes. LaTeX input supports UTF-8 and BOM-marked UTF-16. Archives are read in memory, never unpacked as executable filesystem paths, and expanded content is bounded to 100 MiB per record. LaTeX is a [document preparation system](https://www.latex-project.org/about/), separate from a character encoding.

All exports copy original attachments into `<output-name>.assets/` and write `<output-name>.manifest.json`. The manifest reports effective settings, exported records, and skipped records. JSONL and preserve-source indexes refer to the copied assets by relative paths. Structured API datasets retain the original response fields supplied by each connector in metadata; this is not a claim that every HTTP response is archived byte for byte.

## Encodings and transformations

| Setting | Choices and intended use |
| --- | --- |
| Character encoding | UTF-8 for most ML tools and interchange; UTF-16 LE/BE for tools requiring UTF-16; UTF-32 LE/BE for workflows requiring fixed-width Unicode scalar values. All encode the same Unicode text without dropping non-ASCII characters. |
| Unicode normalization | None (default), NFC, NFD, NFKC, NFKD. NFC/NFD handle canonical equivalence. NFKC/NFKD additionally fold compatibility characters, which can change code and mathematical notation. |
| Line endings | Preserve, LF, or Windows CRLF. Does not collapse spaces or indentation. Generated document wrappers add their own separators; preserve retains the body's existing line endings. |
| BOM | Automatic (UTF-16/32 only), always, or never. One marker is written at the beginning of a nonempty export, not at each record. |
| Compression | None or gzip. gzip applies to the complete encoded text stream and adds `.gz` to the suggested filename. |

Default: plain text, UTF-8, no Unicode normalization, preserve line endings, automatic BOM (therefore none for UTF-8), uncompressed. UTF-32 typically uses much more storage than UTF-8 for English/code; choose it only if the receiving tool needs it. UTF-16/32 byte order is explicit, and BOM behavior follows the [Unicode encoding FAQ](https://www.unicode.org/faq/utf_bom.html). Normalization choices follow [Unicode Standard Annex #15](https://www.unicode.org/reports/tr15/).

Collected JSON records, JSONL exports, preserve-source indexes, and manifests always remain UTF-8 without a BOM, regardless of the text profile. This follows the [JSON Lines format](https://jsonlines.org/) and keeps structured exports usable by standard dataset tooling. Original binary downloads are never transcoded.

## Why no SCSU, ASCII, or legacy code pages?

Research checked 2026-10-22. [Unicode Technical Standard #6](https://www.unicode.org/reports/tr6/) describes SCSU as stabilized and points to the broader adoption and simplicity of UTF-8. For long texts, UTF-8 with general-purpose compression is more useful to this app's target workflows. The app therefore offers UTF-8 plus [gzip](https://www.rfc-editor.org/rfc/rfc1952.html), rather than an uncommon codec with poor downstream support.

ASCII and legacy code-page output can lose text or require replacement characters. They are omitted in favor of lossless Unicode output and unchanged originals. Source text is not transliterated or sanitized into ASCII. Encoding rejects unpaired Unicode surrogates instead of silently replacing them. Invalid format preferences are rejected at the IPC and exporter boundaries; missing or invalid saved preferences fall back to the default profile.
