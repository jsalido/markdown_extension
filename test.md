# Markdown Reader Test

This file exercises the renderer. Open it in Chrome after loading the extension.

## Text formatting

**Bold**, *italic*, ~~strikethrough~~, `inline code`, and a [link](https://example.com).

> A blockquote with some wisdom in it.

## Lists

1. First ordered item
2. Second ordered item
   - Nested bullet
   - Another nested bullet

- [x] Completed task
- [ ] Pending task

## Code

```python
def hello(name: str) -> str:
    return f"Hello, {name}!"
```

## Table

| Feature | Status |
|---------|--------|
| Tables  | ✅     |
| Dark mode | ✅   |
| Task lists | ✅  |

## Mermaid

```mermaid
flowchart LR
    A["Markdown"] --> B{"¿mermaid?"}
    B -->|Sí| C["Diagrama SVG"]
    B -->|No| D["Bloque de código"]
```

## Sanitizer check

The next line contains a script tag in the source — it must NOT show an alert:

<script>alert("XSS")</script>

<a href="javascript:alert('XSS')">This link must be inert</a>

<a href="java&#x09;script:alert('XSS')">This obfuscated link must be inert too</a>

<svg width="200" height="20"><a><animate attributeName="href" to="javascript:alert('XSS')"/><text y="15">Neither must this SVG link</text></a></svg>

<style>body { background: red; }</style>

The page background must not turn red.

## Heading ids

[Jump to Configuración avanzada](#configuración-avanzada)

### Configuración avanzada

Single newlines inside a paragraph
should not become line breaks.

---

Press `r` to see the raw source.
