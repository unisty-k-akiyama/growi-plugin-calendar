# GROWI Calendar Plugin

Calendar plugin for GROWI.

This plugin provides a calendar view and a page viewer for date-based pages.

---

## Features

- `$calendar(...)`  
  Displays a calendar and highlights dates that have corresponding pages.
- `$calendar_viewer(...)`  
  Displays recent date pages and their content (similar to PukiWiki `calendar_viewer`).

---

## Install

Install this plugin from the GROWI admin plugin page.

---

## Usage

### Calendar

```
$calendar()
```

Clicking a date navigates to the corresponding page.

Default page format:

```
YYYY/MM/DD
```

---

### Calendar Options

#### Specify month and year

```
$calendar(10,2020)
```

#### Specify locale

```
$calendar(locale=ja)
$calendar(10,2020,locale=ja)
```

#### Specify date separator

```
$calendar(separator=-)
$calendar(10,2020,locale=ja,separator=-)
```

#### Specify base path

```
$calendar(basePath=/parent/page)
```

---

## Calendar Viewer

Displays recent date pages and their content.

### Default (latest 5 pages under current path)

```
$calendar_viewer()
```

### Specify number of pages

```
$calendar_viewer(5)
```

### Specify base path and limit

```
$calendar_viewer(/parent/page,5)
```

---

## Behavior

- Targets pages with names like:

```
YYYY-MM-DD
```

- Displays newer pages first
- Renders Markdown content
- Resolves relative links based on each page path
- Images can be clicked to open a preview overlay

---

## Example

```
$calendar(locale=ja, separator=-)

$calendar_viewer()
```

---

## License

MIT

---

## Notes

This repository is forked and customized for internal GROWI usage.