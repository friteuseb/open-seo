/**
 * Tells a page's template apart from its editorial body.
 *
 * "Template" here is the furniture repeated across the site — menu, breadcrumb,
 * sidebar, footer. The flag it produces is `isBoilerplate`, and the UI calls
 * these template links.
 *
 * Internal-link analysis is about links an author placed in the content. A
 * menu that links every page to every other page flattens PageRank, buries
 * the real hierarchy and makes every page look well-linked, so template links
 * are classified here and kept out of the link graph's metrics.
 *
 * Two signals, because real sites split evenly between them:
 *  - landmarks (`<nav>`, `<footer>`, `role="navigation"`, ...) on modern markup;
 *  - class/id stems, for the div soup that predates them.
 */

/** Part of the template wherever they appear. */
const BOILERPLATE_TAGS = new Set(["nav", "aside"]);
/**
 * Part of the template only at page level. HTML scopes `<header>`/`<footer>`
 * to the nearest sectioning element, and templates lean on that hard: `<header
 * class="entry-header">` around a card's title is the norm on WordPress,
 * while the site's own banner sits outside the content scope.
 */
const SCOPED_BOILERPLATE_TAGS = new Set(["header", "footer"]);
/** Elements that put a `<header>`/`<footer>` inside the page's content. */
const CONTENT_SCOPE_TAGS = new Set(["main", "article", "section"]);

const BOILERPLATE_ROLES = new Set([
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "menu",
  "menubar",
  "menuitem",
  "toolbar",
  "search",
]);

/**
 * Matched against `class` and `id`, on a word boundary that also treats `-`
 * and `_` as separators — real markup writes `main-navigation`, `nav__list`
 * and `footer-widgets`. Deliberately short: bare "header" is left out because
 * `post-header`/`section-header` wrap editorial links, and "banner" because a
 * hero is content.
 */
const BOILERPLATE_CLASS_PATTERN =
  /(^|[\s_-])(nav|navbar|navigation|menu|submenu|megamenu|topbar|masthead|breadcrumbs?|footer|sidebar|widget|offcanvas|pagination|pager|colophon|skiplink)([\s_-]|$)/;

/**
 * Never part of the template, whatever they are labelled. WordPress hangs
 * page state on the body element — `class="home ... fixed-nav menu-home"` —
 * and reading that as a menu would classify the whole document as one big
 * template.
 */
const ROOT_TAGS = new Set(["html", "body", "main"]);

export function isContentScopeTag(tagName: string): boolean {
  return CONTENT_SCOPE_TAGS.has(tagName);
}

/**
 * Whether an element opens a template subtree. `sectioningDepth` is how many
 * `<article>`/`<section>` ancestors the element sits in, including itself.
 */
export function isBoilerplateContainer(
  tagName: string,
  attribs: Record<string, string>,
  sectioningDepth: number,
): boolean {
  if (ROOT_TAGS.has(tagName)) return false;
  if (BOILERPLATE_TAGS.has(tagName)) return true;
  if (SCOPED_BOILERPLATE_TAGS.has(tagName) && sectioningDepth === 0)
    return true;

  const role = attribs["role"]?.trim().toLowerCase();
  if (role && BOILERPLATE_ROLES.has(role)) return true;

  const className = attribs["class"]?.toLowerCase();
  if (className && BOILERPLATE_CLASS_PATTERN.test(className)) return true;

  const id = attribs["id"]?.toLowerCase();
  return Boolean(id && BOILERPLATE_CLASS_PATTERN.test(id));
}
