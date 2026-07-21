import { ENGLISH_STATIC } from "./i18n/englishStatic.js";
import * as dynamicDictionary from "./i18n/englishDynamic.js";
import { ENGLISH_VIEWS } from "./i18n/englishViews.js";

export const LOCALE_STORAGE_KEY = "3d-baduk-locale-v1";
export const LOCALE_CHINESE = "zh-CN";
export const LOCALE_ENGLISH = "en";

const ENGLISH_DYNAMIC = dynamicDictionary.ENGLISH_DYNAMIC ?? {};
const ENGLISH_PATTERNS = Array.isArray(dynamicDictionary.ENGLISH_PATTERNS)
  ? dynamicDictionary.ENGLISH_PATTERNS
  : [];
const ENGLISH_TEXT = Object.freeze({
  ...ENGLISH_STATIC,
  ...ENGLISH_DYNAMIC,
  ...ENGLISH_VIEWS,
});

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const DOCUMENT_NODE = 9;
const TRANSLATED_ATTRIBUTES = Object.freeze([
  "aria-label",
  "title",
  "placeholder",
]);
const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE"]);

const textSources = new WeakMap();
const attributeSources = new WeakMap();
const localeSubscribers = new Set();

let currentLocale = LOCALE_ENGLISH;
let activeStorage = null;
let activeDocument = null;
let activeRoot = null;
let mutationObserver = null;

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function browserLanguages() {
  try {
    if (Array.isArray(globalThis.navigator?.languages)) {
      return globalThis.navigator.languages;
    }
    return globalThis.navigator?.language
      ? [globalThis.navigator.language]
      : [];
  } catch {
    return [];
  }
}

function browserDocument() {
  try {
    return globalThis.document ?? null;
  } catch {
    return null;
  }
}

function normalizeLocale(value) {
  const locale = typeof value === "string" ? value.trim() : "";
  return /^zh(?:-|$)/iu.test(locale) ? LOCALE_CHINESE : LOCALE_ENGLISH;
}

/**
 * Resolve the UI locale. A stored manual choice wins over browser preference.
 * The product intentionally supports two choices: every Chinese locale uses
 * Simplified Chinese UI copy and every other locale falls back to English.
 */
export function resolveLocale(
  options = {},
  positionalLanguages = undefined,
) {
  let savedLocale;
  let languages;
  if (
    options &&
    typeof options === "object" &&
    !Array.isArray(options)
  ) {
    savedLocale = options.savedLocale;
    languages = options.languages;
  } else {
    savedLocale = options;
    languages = positionalLanguages;
  }

  if (typeof savedLocale === "string" && savedLocale.trim()) {
    const saved = savedLocale.trim();
    if (/^zh(?:-|$)/iu.test(saved)) return LOCALE_CHINESE;
    if (/^en(?:-|$)/iu.test(saved)) return LOCALE_ENGLISH;
  }

  const preferences = Array.isArray(languages)
    ? languages
    : typeof languages === "string"
      ? [languages]
      : [];
  return normalizeLocale(
    preferences.find((language) =>
      typeof language === "string" && language.trim()
    ) ?? "",
  );
}

function readSavedLocale(storage) {
  try {
    return storage?.getItem?.(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function persistLocale(storage, locale) {
  try {
    storage?.setItem?.(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Privacy modes and disabled storage must never prevent the UI switching.
  }
}

function interpolate(template, params) {
  if (!params || typeof params !== "object") return template;
  return template.replace(/\{([A-Za-z0-9_.-]+)\}/gu, (match, key) =>
    Object.prototype.hasOwnProperty.call(params, key)
      ? String(params[key])
      : match
  );
}

function patternTranslation(source) {
  for (const candidate of ENGLISH_PATTERNS) {
    if (
      !(candidate?.pattern instanceof RegExp) ||
      !["string", "function"].includes(typeof candidate.replace)
    ) {
      continue;
    }
    const pattern = new RegExp(candidate.pattern.source, candidate.pattern.flags);
    const translated = source.replace(pattern, candidate.replace);
    if (translated !== source) return translated;
  }
  return source;
}

/** Translate one Chinese source string and apply simple {parameter} values. */
export function translateText(source, params = {}, locale = currentLocale) {
  if (typeof params === "string") {
    locale = params;
    params = {};
  }
  const text = source === null || source === undefined ? "" : String(source);
  if (normalizeLocale(locale) === LOCALE_CHINESE) {
    return interpolate(text, params);
  }
  const exact = ENGLISH_TEXT[text];
  const translated = typeof exact === "string"
    ? exact
    : patternTranslation(text);
  return interpolate(translated, params);
}

function translatePreservingWhitespace(source) {
  const match = String(source).match(/^(\s*)([\s\S]*?)(\s*)$/u);
  if (!match || !match[2]) return String(source);
  return `${match[1]}${translateText(match[2])}${match[3]}`;
}

function elementHasAttribute(element, name) {
  return typeof element?.hasAttribute === "function" && element.hasAttribute(name);
}

function shouldSkipElement(element, inheritedSkip = false) {
  if (inheritedSkip) return true;
  let current = element;
  while (current?.nodeType === ELEMENT_NODE) {
    const tagName = String(current.tagName ?? "").toUpperCase();
    if (
      SKIPPED_TAGS.has(tagName) ||
      elementHasAttribute(current, "data-i18n-ignore")
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function translateTextNode(node) {
  const current = String(node.nodeValue ?? "");
  const previous = textSources.get(node);
  const source = previous && current === previous.rendered
    ? previous.source
    : current;
  const rendered = translatePreservingWhitespace(source);
  textSources.set(node, { source, rendered });
  if (current !== rendered) node.nodeValue = rendered;
}

function translatableAttributes(element) {
  const attributes = [...TRANSLATED_ATTRIBUTES];
  if (String(element.tagName ?? "").toUpperCase() === "META") {
    attributes.push("content");
  }
  return attributes;
}

function translateAttribute(element, attribute) {
  if (
    typeof element?.getAttribute !== "function" ||
    typeof element?.setAttribute !== "function" ||
    !elementHasAttribute(element, attribute)
  ) {
    return;
  }
  if (
    attribute === "content" &&
    String(element.tagName ?? "").toUpperCase() !== "META"
  ) {
    return;
  }

  let records = attributeSources.get(element);
  if (!records) {
    records = new Map();
    attributeSources.set(element, records);
  }
  const current = String(element.getAttribute(attribute) ?? "");
  const previous = records.get(attribute);
  const source = previous && current === previous.rendered
    ? previous.source
    : current;
  const rendered = translateText(source);
  records.set(attribute, { source, rendered });
  if (current !== rendered) element.setAttribute(attribute, rendered);
}

function translateNode(node, inheritedSkip = false) {
  if (!node) return;
  if (node.nodeType === TEXT_NODE) {
    if (!inheritedSkip) translateTextNode(node);
    return;
  }

  const isElement = node.nodeType === ELEMENT_NODE;
  const skip = isElement
    ? shouldSkipElement(node, inheritedSkip)
    : inheritedSkip;
  if (isElement && !skip) {
    for (const attribute of translatableAttributes(node)) {
      translateAttribute(node, attribute);
    }
  }
  if (skip) return;
  for (const child of Array.from(node.childNodes ?? [])) {
    translateNode(child, false);
  }
}

function rootDocument(root) {
  if (root?.nodeType === DOCUMENT_NODE) return root;
  return root?.ownerDocument ?? activeDocument ?? browserDocument();
}

function syncDocumentLanguage(documentValue) {
  if (documentValue?.documentElement) {
    documentValue.documentElement.lang = currentLocale;
  }
}

/** Translate existing text nodes and accessibility/form metadata in place. */
export function applyDocumentTranslations(root = activeRoot ?? browserDocument()) {
  if (!root) return currentLocale;
  const documentValue = rootDocument(root);
  syncDocumentLanguage(documentValue);
  translateNode(root);
  return currentLocale;
}

function observeDocument(root, Observer = globalThis.MutationObserver) {
  mutationObserver?.disconnect?.();
  mutationObserver = null;
  if (typeof Observer !== "function" || !root) return;
  const target = root.nodeType === DOCUMENT_NODE
    ? root.documentElement
    : root;
  if (!target) return;

  mutationObserver = new Observer((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        const parent = mutation.target?.parentElement;
        if (!shouldSkipElement(parent)) translateTextNode(mutation.target);
        continue;
      }
      if (mutation.type === "attributes") {
        if (!shouldSkipElement(mutation.target)) {
          translateAttribute(mutation.target, mutation.attributeName);
        }
        continue;
      }
      for (const node of Array.from(mutation.addedNodes ?? [])) {
        translateNode(node, shouldSkipElement(mutation.target));
      }
    }
  });
  mutationObserver.observe(target, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATED_ATTRIBUTES, "content"],
  });
}

export function getLocale() {
  return currentLocale;
}

export function subscribeLocale(listener) {
  if (typeof listener !== "function") {
    throw new TypeError("locale subscriber must be a function");
  }
  localeSubscribers.add(listener);
  return () => localeSubscribers.delete(listener);
}

export function setLocale(locale, { persist = true } = {}) {
  const nextLocale = normalizeLocale(locale);
  const previousLocale = currentLocale;
  currentLocale = nextLocale;
  if (persist) persistLocale(activeStorage ?? browserStorage(), nextLocale);
  syncDocumentLanguage(activeDocument ?? browserDocument());
  applyDocumentTranslations(activeRoot ?? activeDocument ?? browserDocument());
  if (previousLocale !== nextLocale) {
    for (const subscriber of [...localeSubscribers]) {
      subscriber(nextLocale, previousLocale);
    }
  }
  return nextLocale;
}

/** Initialize once at application startup; safe to call again in tests/HMR. */
export function initializeI18n({
  storage = browserStorage(),
  languages = browserLanguages(),
  document: documentValue = browserDocument(),
  root = documentValue,
  observe = true,
  MutationObserver: Observer = globalThis.MutationObserver,
} = {}) {
  activeStorage = storage;
  activeDocument = documentValue;
  activeRoot = root;
  currentLocale = resolveLocale({
    savedLocale: readSavedLocale(storage),
    languages,
  });
  syncDocumentLanguage(documentValue);
  applyDocumentTranslations(root);
  if (observe) observeDocument(root, Observer);
  else {
    mutationObserver?.disconnect?.();
    mutationObserver = null;
  }
  return currentLocale;
}
