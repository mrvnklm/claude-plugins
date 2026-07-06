(() => {
  // ../../node_modules/@medv/finder/finder.js
  var acceptedAttrNames = /* @__PURE__ */ new Set(["role", "name", "aria-label", "rel", "href"]);
  function attr(name, value) {
    let nameIsOk = acceptedAttrNames.has(name);
    nameIsOk ||= name.startsWith("data-") && wordLike(name);
    let valueIsOk = wordLike(value) && value.length < 100;
    valueIsOk ||= value.startsWith("#") && wordLike(value.slice(1));
    return nameIsOk && valueIsOk;
  }
  function idName(name) {
    return wordLike(name);
  }
  function className(name) {
    return wordLike(name);
  }
  function tagName(name) {
    return true;
  }
  function finder(input, options) {
    if (input.nodeType !== Node.ELEMENT_NODE) {
      throw new Error(`Can't generate CSS selector for non-element node type.`);
    }
    if (input.tagName.toLowerCase() === "html") {
      return "html";
    }
    const defaults = {
      root: document.body,
      idName,
      className,
      tagName,
      attr,
      timeoutMs: 1e3,
      seedMinLength: 3,
      optimizedMinLength: 2,
      maxNumberOfPathChecks: Infinity
    };
    const startTime = /* @__PURE__ */ new Date();
    const config = { ...defaults, ...options };
    const rootDocument = findRootDocument(config.root, defaults);
    let foundPath;
    let count = 0;
    for (const candidate of search(input, config, rootDocument)) {
      const elapsedTimeMs = (/* @__PURE__ */ new Date()).getTime() - startTime.getTime();
      if (elapsedTimeMs > config.timeoutMs || count >= config.maxNumberOfPathChecks) {
        const fPath = fallback(input, rootDocument);
        if (!fPath) {
          throw new Error(`Timeout: Can't find a unique selector after ${config.timeoutMs}ms`);
        }
        return selector(fPath);
      }
      count++;
      if (unique(candidate, rootDocument)) {
        foundPath = candidate;
        break;
      }
    }
    if (!foundPath) {
      throw new Error(`Selector was not found.`);
    }
    const optimized = [
      ...optimize(foundPath, input, config, rootDocument, startTime)
    ];
    optimized.sort(byPenalty);
    if (optimized.length > 0) {
      return selector(optimized[0]);
    }
    return selector(foundPath);
  }
  function* search(input, config, rootDocument) {
    const stack = [];
    let paths = [];
    let current = input;
    let i = 0;
    while (current && current !== rootDocument) {
      const level = tie(current, config);
      for (const node of level) {
        node.level = i;
      }
      stack.push(level);
      current = current.parentElement;
      i++;
      paths.push(...combinations(stack));
      if (i >= config.seedMinLength) {
        paths.sort(byPenalty);
        for (const candidate of paths) {
          yield candidate;
        }
        paths = [];
      }
    }
    paths.sort(byPenalty);
    for (const candidate of paths) {
      yield candidate;
    }
  }
  function wordLike(name) {
    if (/^[a-z\-]{3,}$/i.test(name)) {
      const words = name.split(/-|[A-Z]/);
      for (const word of words) {
        if (word.length <= 2) {
          return false;
        }
        if (/[^aeiou]{4,}/i.test(word)) {
          return false;
        }
      }
      return true;
    }
    return false;
  }
  function tie(element, config) {
    const level = [];
    const elementId = element.getAttribute("id");
    if (elementId && config.idName(elementId)) {
      level.push({
        name: "#" + CSS.escape(elementId),
        penalty: 0
      });
    }
    for (let i = 0; i < element.classList.length; i++) {
      const name = element.classList[i];
      if (config.className(name)) {
        level.push({
          name: "." + CSS.escape(name),
          penalty: 1
        });
      }
    }
    for (let i = 0; i < element.attributes.length; i++) {
      const attr2 = element.attributes[i];
      if (config.attr(attr2.name, attr2.value)) {
        level.push({
          name: `[${CSS.escape(attr2.name)}="${CSS.escape(attr2.value)}"]`,
          penalty: 2
        });
      }
    }
    const tagName2 = element.tagName.toLowerCase();
    if (config.tagName(tagName2)) {
      level.push({
        name: tagName2,
        penalty: 5
      });
      const index = indexOf(element, tagName2);
      if (index !== void 0) {
        level.push({
          name: nthOfType(tagName2, index),
          penalty: 10
        });
      }
    }
    const nth = indexOf(element);
    if (nth !== void 0) {
      level.push({
        name: nthChild(tagName2, nth),
        penalty: 50
      });
    }
    return level;
  }
  function selector(path) {
    let node = path[0];
    let query = node.name;
    for (let i = 1; i < path.length; i++) {
      const level = path[i].level || 0;
      if (node.level === level - 1) {
        query = `${path[i].name} > ${query}`;
      } else {
        query = `${path[i].name} ${query}`;
      }
      node = path[i];
    }
    return query;
  }
  function penalty(path) {
    return path.map((node) => node.penalty).reduce((acc, i) => acc + i, 0);
  }
  function byPenalty(a, b) {
    return penalty(a) - penalty(b);
  }
  function indexOf(input, tagName2) {
    const parent = input.parentNode;
    if (!parent) {
      return void 0;
    }
    let child = parent.firstChild;
    if (!child) {
      return void 0;
    }
    let i = 0;
    while (child) {
      if (child.nodeType === Node.ELEMENT_NODE && (tagName2 === void 0 || child.tagName.toLowerCase() === tagName2)) {
        i++;
      }
      if (child === input) {
        break;
      }
      child = child.nextSibling;
    }
    return i;
  }
  function fallback(input, rootDocument) {
    let i = 0;
    let current = input;
    const path = [];
    while (current && current !== rootDocument) {
      const tagName2 = current.tagName.toLowerCase();
      const index = indexOf(current, tagName2);
      if (index === void 0) {
        return;
      }
      path.push({
        name: nthOfType(tagName2, index),
        penalty: NaN,
        level: i
      });
      current = current.parentElement;
      i++;
    }
    if (unique(path, rootDocument)) {
      return path;
    }
  }
  function nthChild(tagName2, index) {
    if (tagName2 === "html") {
      return "html";
    }
    return `${tagName2}:nth-child(${index})`;
  }
  function nthOfType(tagName2, index) {
    if (tagName2 === "html") {
      return "html";
    }
    return `${tagName2}:nth-of-type(${index})`;
  }
  function* combinations(stack, path = []) {
    if (stack.length > 0) {
      for (let node of stack[0]) {
        yield* combinations(stack.slice(1, stack.length), path.concat(node));
      }
    } else {
      yield path;
    }
  }
  function findRootDocument(rootNode, defaults) {
    if (rootNode.nodeType === Node.DOCUMENT_NODE) {
      return rootNode;
    }
    if (rootNode === defaults.root) {
      return rootNode.ownerDocument;
    }
    return rootNode;
  }
  function unique(path, rootDocument) {
    const css = selector(path);
    switch (rootDocument.querySelectorAll(css).length) {
      case 0:
        throw new Error(`Can't select any node with this selector: ${css}`);
      case 1:
        return true;
      default:
        return false;
    }
  }
  function* optimize(path, input, config, rootDocument, startTime) {
    if (path.length > 2 && path.length > config.optimizedMinLength) {
      for (let i = 1; i < path.length - 1; i++) {
        const elapsedTimeMs = (/* @__PURE__ */ new Date()).getTime() - startTime.getTime();
        if (elapsedTimeMs > config.timeoutMs) {
          return;
        }
        const newPath = [...path];
        newPath.splice(i, 1);
        if (unique(newPath, rootDocument) && rootDocument.querySelector(selector(newPath)) === input) {
          yield newPath;
          yield* optimize(newPath, input, config, rootDocument, startTime);
        }
      }
    }
  }

  // ../../node_modules/html-to-image/es/util.js
  function resolveUrl(url, baseUrl) {
    if (url.match(/^[a-z]+:\/\//i)) {
      return url;
    }
    if (url.match(/^\/\//)) {
      return window.location.protocol + url;
    }
    if (url.match(/^[a-z]+:/i)) {
      return url;
    }
    const doc = document.implementation.createHTMLDocument();
    const base = doc.createElement("base");
    const a = doc.createElement("a");
    doc.head.appendChild(base);
    doc.body.appendChild(a);
    if (baseUrl) {
      base.href = baseUrl;
    }
    a.href = url;
    return a.href;
  }
  var uuid = /* @__PURE__ */ (() => {
    let counter = 0;
    const random = () => (
      // eslint-disable-next-line no-bitwise
      `0000${(Math.random() * 36 ** 4 << 0).toString(36)}`.slice(-4)
    );
    return () => {
      counter += 1;
      return `u${random()}${counter}`;
    };
  })();
  function toArray(arrayLike) {
    const arr = [];
    for (let i = 0, l = arrayLike.length; i < l; i++) {
      arr.push(arrayLike[i]);
    }
    return arr;
  }
  var styleProps = null;
  function getStyleProperties(options = {}) {
    if (styleProps) {
      return styleProps;
    }
    if (options.includeStyleProperties) {
      styleProps = options.includeStyleProperties;
      return styleProps;
    }
    styleProps = toArray(window.getComputedStyle(document.documentElement));
    return styleProps;
  }
  function px(node, styleProperty) {
    const win = node.ownerDocument.defaultView || window;
    const val = win.getComputedStyle(node).getPropertyValue(styleProperty);
    return val ? parseFloat(val.replace("px", "")) : 0;
  }
  function getNodeWidth(node) {
    const leftBorder = px(node, "border-left-width");
    const rightBorder = px(node, "border-right-width");
    return node.clientWidth + leftBorder + rightBorder;
  }
  function getNodeHeight(node) {
    const topBorder = px(node, "border-top-width");
    const bottomBorder = px(node, "border-bottom-width");
    return node.clientHeight + topBorder + bottomBorder;
  }
  function getImageSize(targetNode, options = {}) {
    const width = options.width || getNodeWidth(targetNode);
    const height = options.height || getNodeHeight(targetNode);
    return { width, height };
  }
  function getPixelRatio() {
    let ratio;
    let FINAL_PROCESS;
    try {
      FINAL_PROCESS = process;
    } catch (e) {
    }
    const val = FINAL_PROCESS && FINAL_PROCESS.env ? FINAL_PROCESS.env.devicePixelRatio : null;
    if (val) {
      ratio = parseInt(val, 10);
      if (Number.isNaN(ratio)) {
        ratio = 1;
      }
    }
    return ratio || window.devicePixelRatio || 1;
  }
  var canvasDimensionLimit = 16384;
  function checkCanvasDimensions(canvas) {
    if (canvas.width > canvasDimensionLimit || canvas.height > canvasDimensionLimit) {
      if (canvas.width > canvasDimensionLimit && canvas.height > canvasDimensionLimit) {
        if (canvas.width > canvas.height) {
          canvas.height *= canvasDimensionLimit / canvas.width;
          canvas.width = canvasDimensionLimit;
        } else {
          canvas.width *= canvasDimensionLimit / canvas.height;
          canvas.height = canvasDimensionLimit;
        }
      } else if (canvas.width > canvasDimensionLimit) {
        canvas.height *= canvasDimensionLimit / canvas.width;
        canvas.width = canvasDimensionLimit;
      } else {
        canvas.width *= canvasDimensionLimit / canvas.height;
        canvas.height = canvasDimensionLimit;
      }
    }
  }
  function createImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        img.decode().then(() => {
          requestAnimationFrame(() => resolve(img));
        });
      };
      img.onerror = reject;
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.src = url;
    });
  }
  async function svgToDataURL(svg) {
    return Promise.resolve().then(() => new XMLSerializer().serializeToString(svg)).then(encodeURIComponent).then((html) => `data:image/svg+xml;charset=utf-8,${html}`);
  }
  async function nodeToDataURL(node, width, height) {
    const xmlns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(xmlns, "svg");
    const foreignObject = document.createElementNS(xmlns, "foreignObject");
    svg.setAttribute("width", `${width}`);
    svg.setAttribute("height", `${height}`);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    foreignObject.setAttribute("width", "100%");
    foreignObject.setAttribute("height", "100%");
    foreignObject.setAttribute("x", "0");
    foreignObject.setAttribute("y", "0");
    foreignObject.setAttribute("externalResourcesRequired", "true");
    svg.appendChild(foreignObject);
    foreignObject.appendChild(node);
    return svgToDataURL(svg);
  }
  var isInstanceOfElement = (node, instance) => {
    if (node instanceof instance)
      return true;
    const nodePrototype = Object.getPrototypeOf(node);
    if (nodePrototype === null)
      return false;
    return nodePrototype.constructor.name === instance.name || isInstanceOfElement(nodePrototype, instance);
  };

  // ../../node_modules/html-to-image/es/clone-pseudos.js
  function formatCSSText(style) {
    const content = style.getPropertyValue("content");
    return `${style.cssText} content: '${content.replace(/'|"/g, "")}';`;
  }
  function formatCSSProperties(style, options) {
    return getStyleProperties(options).map((name) => {
      const value = style.getPropertyValue(name);
      const priority = style.getPropertyPriority(name);
      return `${name}: ${value}${priority ? " !important" : ""};`;
    }).join(" ");
  }
  function getPseudoElementStyle(className2, pseudo, style, options) {
    const selector2 = `.${className2}:${pseudo}`;
    const cssText = style.cssText ? formatCSSText(style) : formatCSSProperties(style, options);
    return document.createTextNode(`${selector2}{${cssText}}`);
  }
  function clonePseudoElement(nativeNode, clonedNode, pseudo, options) {
    const style = window.getComputedStyle(nativeNode, pseudo);
    const content = style.getPropertyValue("content");
    if (content === "" || content === "none") {
      return;
    }
    const className2 = uuid();
    try {
      clonedNode.className = `${clonedNode.className} ${className2}`;
    } catch (err) {
      return;
    }
    const styleElement = document.createElement("style");
    styleElement.appendChild(getPseudoElementStyle(className2, pseudo, style, options));
    clonedNode.appendChild(styleElement);
  }
  function clonePseudoElements(nativeNode, clonedNode, options) {
    clonePseudoElement(nativeNode, clonedNode, ":before", options);
    clonePseudoElement(nativeNode, clonedNode, ":after", options);
  }

  // ../../node_modules/html-to-image/es/mimes.js
  var WOFF = "application/font-woff";
  var JPEG = "image/jpeg";
  var mimes = {
    woff: WOFF,
    woff2: WOFF,
    ttf: "application/font-truetype",
    eot: "application/vnd.ms-fontobject",
    png: "image/png",
    jpg: JPEG,
    jpeg: JPEG,
    gif: "image/gif",
    tiff: "image/tiff",
    svg: "image/svg+xml",
    webp: "image/webp"
  };
  function getExtension(url) {
    const match = /\.([^./]*?)$/g.exec(url);
    return match ? match[1] : "";
  }
  function getMimeType(url) {
    const extension = getExtension(url).toLowerCase();
    return mimes[extension] || "";
  }

  // ../../node_modules/html-to-image/es/dataurl.js
  function getContentFromDataUrl(dataURL) {
    return dataURL.split(/,/)[1];
  }
  function isDataUrl(url) {
    return url.search(/^(data:)/) !== -1;
  }
  function makeDataUrl(content, mimeType) {
    return `data:${mimeType};base64,${content}`;
  }
  async function fetchAsDataURL(url, init2, process2) {
    const res = await fetch(url, init2);
    if (res.status === 404) {
      throw new Error(`Resource "${res.url}" not found`);
    }
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onloadend = () => {
        try {
          resolve(process2({ res, result: reader.result }));
        } catch (error) {
          reject(error);
        }
      };
      reader.readAsDataURL(blob);
    });
  }
  var cache = {};
  function getCacheKey(url, contentType, includeQueryParams) {
    let key = url.replace(/\?.*/, "");
    if (includeQueryParams) {
      key = url;
    }
    if (/ttf|otf|eot|woff2?/i.test(key)) {
      key = key.replace(/.*\//, "");
    }
    return contentType ? `[${contentType}]${key}` : key;
  }
  async function resourceToDataURL(resourceUrl, contentType, options) {
    const cacheKey = getCacheKey(resourceUrl, contentType, options.includeQueryParams);
    if (cache[cacheKey] != null) {
      return cache[cacheKey];
    }
    if (options.cacheBust) {
      resourceUrl += (/\?/.test(resourceUrl) ? "&" : "?") + (/* @__PURE__ */ new Date()).getTime();
    }
    let dataURL;
    try {
      const content = await fetchAsDataURL(resourceUrl, options.fetchRequestInit, ({ res, result }) => {
        if (!contentType) {
          contentType = res.headers.get("Content-Type") || "";
        }
        return getContentFromDataUrl(result);
      });
      dataURL = makeDataUrl(content, contentType);
    } catch (error) {
      dataURL = options.imagePlaceholder || "";
      let msg = `Failed to fetch resource: ${resourceUrl}`;
      if (error) {
        msg = typeof error === "string" ? error : error.message;
      }
      if (msg) {
        console.warn(msg);
      }
    }
    cache[cacheKey] = dataURL;
    return dataURL;
  }

  // ../../node_modules/html-to-image/es/clone-node.js
  async function cloneCanvasElement(canvas) {
    const dataURL = canvas.toDataURL();
    if (dataURL === "data:,") {
      return canvas.cloneNode(false);
    }
    return createImage(dataURL);
  }
  async function cloneVideoElement(video, options) {
    if (video.currentSrc) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
      ctx === null || ctx === void 0 ? void 0 : ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataURL2 = canvas.toDataURL();
      return createImage(dataURL2);
    }
    const poster = video.poster;
    const contentType = getMimeType(poster);
    const dataURL = await resourceToDataURL(poster, contentType, options);
    return createImage(dataURL);
  }
  async function cloneIFrameElement(iframe, options) {
    var _a;
    try {
      if ((_a = iframe === null || iframe === void 0 ? void 0 : iframe.contentDocument) === null || _a === void 0 ? void 0 : _a.body) {
        return await cloneNode(iframe.contentDocument.body, options, true);
      }
    } catch (_b) {
    }
    return iframe.cloneNode(false);
  }
  async function cloneSingleNode(node, options) {
    if (isInstanceOfElement(node, HTMLCanvasElement)) {
      return cloneCanvasElement(node);
    }
    if (isInstanceOfElement(node, HTMLVideoElement)) {
      return cloneVideoElement(node, options);
    }
    if (isInstanceOfElement(node, HTMLIFrameElement)) {
      return cloneIFrameElement(node, options);
    }
    return node.cloneNode(isSVGElement(node));
  }
  var isSlotElement = (node) => node.tagName != null && node.tagName.toUpperCase() === "SLOT";
  var isSVGElement = (node) => node.tagName != null && node.tagName.toUpperCase() === "SVG";
  async function cloneChildren(nativeNode, clonedNode, options) {
    var _a, _b;
    if (isSVGElement(clonedNode)) {
      return clonedNode;
    }
    let children = [];
    if (isSlotElement(nativeNode) && nativeNode.assignedNodes) {
      children = toArray(nativeNode.assignedNodes());
    } else if (isInstanceOfElement(nativeNode, HTMLIFrameElement) && ((_a = nativeNode.contentDocument) === null || _a === void 0 ? void 0 : _a.body)) {
      children = toArray(nativeNode.contentDocument.body.childNodes);
    } else {
      children = toArray(((_b = nativeNode.shadowRoot) !== null && _b !== void 0 ? _b : nativeNode).childNodes);
    }
    if (children.length === 0 || isInstanceOfElement(nativeNode, HTMLVideoElement)) {
      return clonedNode;
    }
    await children.reduce((deferred, child) => deferred.then(() => cloneNode(child, options)).then((clonedChild) => {
      if (clonedChild) {
        clonedNode.appendChild(clonedChild);
      }
    }), Promise.resolve());
    return clonedNode;
  }
  function cloneCSSStyle(nativeNode, clonedNode, options) {
    const targetStyle = clonedNode.style;
    if (!targetStyle) {
      return;
    }
    const sourceStyle = window.getComputedStyle(nativeNode);
    if (sourceStyle.cssText) {
      targetStyle.cssText = sourceStyle.cssText;
      targetStyle.transformOrigin = sourceStyle.transformOrigin;
    } else {
      getStyleProperties(options).forEach((name) => {
        let value = sourceStyle.getPropertyValue(name);
        if (name === "font-size" && value.endsWith("px")) {
          const reducedFont = Math.floor(parseFloat(value.substring(0, value.length - 2))) - 0.1;
          value = `${reducedFont}px`;
        }
        if (isInstanceOfElement(nativeNode, HTMLIFrameElement) && name === "display" && value === "inline") {
          value = "block";
        }
        if (name === "d" && clonedNode.getAttribute("d")) {
          value = `path(${clonedNode.getAttribute("d")})`;
        }
        targetStyle.setProperty(name, value, sourceStyle.getPropertyPriority(name));
      });
    }
  }
  function cloneInputValue(nativeNode, clonedNode) {
    if (isInstanceOfElement(nativeNode, HTMLTextAreaElement)) {
      clonedNode.innerHTML = nativeNode.value;
    }
    if (isInstanceOfElement(nativeNode, HTMLInputElement)) {
      clonedNode.setAttribute("value", nativeNode.value);
    }
  }
  function cloneSelectValue(nativeNode, clonedNode) {
    if (isInstanceOfElement(nativeNode, HTMLSelectElement)) {
      const clonedSelect = clonedNode;
      const selectedOption = Array.from(clonedSelect.children).find((child) => nativeNode.value === child.getAttribute("value"));
      if (selectedOption) {
        selectedOption.setAttribute("selected", "");
      }
    }
  }
  function decorate(nativeNode, clonedNode, options) {
    if (isInstanceOfElement(clonedNode, Element)) {
      cloneCSSStyle(nativeNode, clonedNode, options);
      clonePseudoElements(nativeNode, clonedNode, options);
      cloneInputValue(nativeNode, clonedNode);
      cloneSelectValue(nativeNode, clonedNode);
    }
    return clonedNode;
  }
  async function ensureSVGSymbols(clone, options) {
    const uses = clone.querySelectorAll ? clone.querySelectorAll("use") : [];
    if (uses.length === 0) {
      return clone;
    }
    const processedDefs = {};
    for (let i = 0; i < uses.length; i++) {
      const use = uses[i];
      const id = use.getAttribute("xlink:href");
      if (id) {
        const exist = clone.querySelector(id);
        const definition = document.querySelector(id);
        if (!exist && definition && !processedDefs[id]) {
          processedDefs[id] = await cloneNode(definition, options, true);
        }
      }
    }
    const nodes = Object.values(processedDefs);
    if (nodes.length) {
      const ns = "http://www.w3.org/1999/xhtml";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("xmlns", ns);
      svg.style.position = "absolute";
      svg.style.width = "0";
      svg.style.height = "0";
      svg.style.overflow = "hidden";
      svg.style.display = "none";
      const defs = document.createElementNS(ns, "defs");
      svg.appendChild(defs);
      for (let i = 0; i < nodes.length; i++) {
        defs.appendChild(nodes[i]);
      }
      clone.appendChild(svg);
    }
    return clone;
  }
  async function cloneNode(node, options, isRoot) {
    if (!isRoot && options.filter && !options.filter(node)) {
      return null;
    }
    return Promise.resolve(node).then((clonedNode) => cloneSingleNode(clonedNode, options)).then((clonedNode) => cloneChildren(node, clonedNode, options)).then((clonedNode) => decorate(node, clonedNode, options)).then((clonedNode) => ensureSVGSymbols(clonedNode, options));
  }

  // ../../node_modules/html-to-image/es/embed-resources.js
  var URL_REGEX = /url\((['"]?)([^'"]+?)\1\)/g;
  var URL_WITH_FORMAT_REGEX = /url\([^)]+\)\s*format\((["']?)([^"']+)\1\)/g;
  var FONT_SRC_REGEX = /src:\s*(?:url\([^)]+\)\s*format\([^)]+\)[,;]\s*)+/g;
  function toRegex(url) {
    const escaped = url.replace(/([.*+?^${}()|\[\]\/\\])/g, "\\$1");
    return new RegExp(`(url\\(['"]?)(${escaped})(['"]?\\))`, "g");
  }
  function parseURLs(cssText) {
    const urls = [];
    cssText.replace(URL_REGEX, (raw, quotation, url) => {
      urls.push(url);
      return raw;
    });
    return urls.filter((url) => !isDataUrl(url));
  }
  async function embed(cssText, resourceURL, baseURL, options, getContentFromUrl) {
    try {
      const resolvedURL = baseURL ? resolveUrl(resourceURL, baseURL) : resourceURL;
      const contentType = getMimeType(resourceURL);
      let dataURL;
      if (getContentFromUrl) {
        const content = await getContentFromUrl(resolvedURL);
        dataURL = makeDataUrl(content, contentType);
      } else {
        dataURL = await resourceToDataURL(resolvedURL, contentType, options);
      }
      return cssText.replace(toRegex(resourceURL), `$1${dataURL}$3`);
    } catch (error) {
    }
    return cssText;
  }
  function filterPreferredFontFormat(str, { preferredFontFormat }) {
    return !preferredFontFormat ? str : str.replace(FONT_SRC_REGEX, (match) => {
      while (true) {
        const [src, , format] = URL_WITH_FORMAT_REGEX.exec(match) || [];
        if (!format) {
          return "";
        }
        if (format === preferredFontFormat) {
          return `src: ${src};`;
        }
      }
    });
  }
  function shouldEmbed(url) {
    return url.search(URL_REGEX) !== -1;
  }
  async function embedResources(cssText, baseUrl, options) {
    if (!shouldEmbed(cssText)) {
      return cssText;
    }
    const filteredCSSText = filterPreferredFontFormat(cssText, options);
    const urls = parseURLs(filteredCSSText);
    return urls.reduce((deferred, url) => deferred.then((css) => embed(css, url, baseUrl, options)), Promise.resolve(filteredCSSText));
  }

  // ../../node_modules/html-to-image/es/embed-images.js
  async function embedProp(propName, node, options) {
    var _a;
    const propValue = (_a = node.style) === null || _a === void 0 ? void 0 : _a.getPropertyValue(propName);
    if (propValue) {
      const cssString = await embedResources(propValue, null, options);
      node.style.setProperty(propName, cssString, node.style.getPropertyPriority(propName));
      return true;
    }
    return false;
  }
  async function embedBackground(clonedNode, options) {
    ;
    await embedProp("background", clonedNode, options) || await embedProp("background-image", clonedNode, options);
    await embedProp("mask", clonedNode, options) || await embedProp("-webkit-mask", clonedNode, options) || await embedProp("mask-image", clonedNode, options) || await embedProp("-webkit-mask-image", clonedNode, options);
  }
  async function embedImageNode(clonedNode, options) {
    const isImageElement = isInstanceOfElement(clonedNode, HTMLImageElement);
    if (!(isImageElement && !isDataUrl(clonedNode.src)) && !(isInstanceOfElement(clonedNode, SVGImageElement) && !isDataUrl(clonedNode.href.baseVal))) {
      return;
    }
    const url = isImageElement ? clonedNode.src : clonedNode.href.baseVal;
    const dataURL = await resourceToDataURL(url, getMimeType(url), options);
    await new Promise((resolve, reject) => {
      clonedNode.onload = resolve;
      clonedNode.onerror = options.onImageErrorHandler ? (...attributes) => {
        try {
          resolve(options.onImageErrorHandler(...attributes));
        } catch (error) {
          reject(error);
        }
      } : reject;
      const image = clonedNode;
      if (image.decode) {
        image.decode = resolve;
      }
      if (image.loading === "lazy") {
        image.loading = "eager";
      }
      if (isImageElement) {
        clonedNode.srcset = "";
        clonedNode.src = dataURL;
      } else {
        clonedNode.href.baseVal = dataURL;
      }
    });
  }
  async function embedChildren(clonedNode, options) {
    const children = toArray(clonedNode.childNodes);
    const deferreds = children.map((child) => embedImages(child, options));
    await Promise.all(deferreds).then(() => clonedNode);
  }
  async function embedImages(clonedNode, options) {
    if (isInstanceOfElement(clonedNode, Element)) {
      await embedBackground(clonedNode, options);
      await embedImageNode(clonedNode, options);
      await embedChildren(clonedNode, options);
    }
  }

  // ../../node_modules/html-to-image/es/apply-style.js
  function applyStyle(node, options) {
    const { style } = node;
    if (options.backgroundColor) {
      style.backgroundColor = options.backgroundColor;
    }
    if (options.width) {
      style.width = `${options.width}px`;
    }
    if (options.height) {
      style.height = `${options.height}px`;
    }
    const manual = options.style;
    if (manual != null) {
      Object.keys(manual).forEach((key) => {
        style[key] = manual[key];
      });
    }
    return node;
  }

  // ../../node_modules/html-to-image/es/embed-webfonts.js
  var cssFetchCache = {};
  async function fetchCSS(url) {
    let cache2 = cssFetchCache[url];
    if (cache2 != null) {
      return cache2;
    }
    const res = await fetch(url);
    const cssText = await res.text();
    cache2 = { url, cssText };
    cssFetchCache[url] = cache2;
    return cache2;
  }
  async function embedFonts(data, options) {
    let cssText = data.cssText;
    const regexUrl = /url\(["']?([^"')]+)["']?\)/g;
    const fontLocs = cssText.match(/url\([^)]+\)/g) || [];
    const loadFonts = fontLocs.map(async (loc) => {
      let url = loc.replace(regexUrl, "$1");
      if (!url.startsWith("https://")) {
        url = new URL(url, data.url).href;
      }
      return fetchAsDataURL(url, options.fetchRequestInit, ({ result }) => {
        cssText = cssText.replace(loc, `url(${result})`);
        return [loc, result];
      });
    });
    return Promise.all(loadFonts).then(() => cssText);
  }
  function parseCSS(source) {
    if (source == null) {
      return [];
    }
    const result = [];
    const commentsRegex = /(\/\*[\s\S]*?\*\/)/gi;
    let cssText = source.replace(commentsRegex, "");
    const keyframesRegex = new RegExp("((@.*?keyframes [\\s\\S]*?){([\\s\\S]*?}\\s*?)})", "gi");
    while (true) {
      const matches = keyframesRegex.exec(cssText);
      if (matches === null) {
        break;
      }
      result.push(matches[0]);
    }
    cssText = cssText.replace(keyframesRegex, "");
    const importRegex = /@import[\s\S]*?url\([^)]*\)[\s\S]*?;/gi;
    const combinedCSSRegex = "((\\s*?(?:\\/\\*[\\s\\S]*?\\*\\/)?\\s*?@media[\\s\\S]*?){([\\s\\S]*?)}\\s*?})|(([\\s\\S]*?){([\\s\\S]*?)})";
    const unifiedRegex = new RegExp(combinedCSSRegex, "gi");
    while (true) {
      let matches = importRegex.exec(cssText);
      if (matches === null) {
        matches = unifiedRegex.exec(cssText);
        if (matches === null) {
          break;
        } else {
          importRegex.lastIndex = unifiedRegex.lastIndex;
        }
      } else {
        unifiedRegex.lastIndex = importRegex.lastIndex;
      }
      result.push(matches[0]);
    }
    return result;
  }
  async function getCSSRules(styleSheets, options) {
    const ret = [];
    const deferreds = [];
    styleSheets.forEach((sheet) => {
      if ("cssRules" in sheet) {
        try {
          toArray(sheet.cssRules || []).forEach((item, index) => {
            if (item.type === CSSRule.IMPORT_RULE) {
              let importIndex = index + 1;
              const url = item.href;
              const deferred = fetchCSS(url).then((metadata) => embedFonts(metadata, options)).then((cssText) => parseCSS(cssText).forEach((rule) => {
                try {
                  sheet.insertRule(rule, rule.startsWith("@import") ? importIndex += 1 : sheet.cssRules.length);
                } catch (error) {
                  console.error("Error inserting rule from remote css", {
                    rule,
                    error
                  });
                }
              })).catch((e) => {
                console.error("Error loading remote css", e.toString());
              });
              deferreds.push(deferred);
            }
          });
        } catch (e) {
          const inline = styleSheets.find((a) => a.href == null) || document.styleSheets[0];
          if (sheet.href != null) {
            deferreds.push(fetchCSS(sheet.href).then((metadata) => embedFonts(metadata, options)).then((cssText) => parseCSS(cssText).forEach((rule) => {
              inline.insertRule(rule, inline.cssRules.length);
            })).catch((err) => {
              console.error("Error loading remote stylesheet", err);
            }));
          }
          console.error("Error inlining remote css file", e);
        }
      }
    });
    return Promise.all(deferreds).then(() => {
      styleSheets.forEach((sheet) => {
        if ("cssRules" in sheet) {
          try {
            toArray(sheet.cssRules || []).forEach((item) => {
              ret.push(item);
            });
          } catch (e) {
            console.error(`Error while reading CSS rules from ${sheet.href}`, e);
          }
        }
      });
      return ret;
    });
  }
  function getWebFontRules(cssRules) {
    return cssRules.filter((rule) => rule.type === CSSRule.FONT_FACE_RULE).filter((rule) => shouldEmbed(rule.style.getPropertyValue("src")));
  }
  async function parseWebFontRules(node, options) {
    if (node.ownerDocument == null) {
      throw new Error("Provided element is not within a Document");
    }
    const styleSheets = toArray(node.ownerDocument.styleSheets);
    const cssRules = await getCSSRules(styleSheets, options);
    return getWebFontRules(cssRules);
  }
  function normalizeFontFamily(font) {
    return font.trim().replace(/["']/g, "");
  }
  function getUsedFonts(node) {
    const fonts = /* @__PURE__ */ new Set();
    function traverse(node2) {
      const fontFamily = node2.style.fontFamily || getComputedStyle(node2).fontFamily;
      fontFamily.split(",").forEach((font) => {
        fonts.add(normalizeFontFamily(font));
      });
      Array.from(node2.children).forEach((child) => {
        if (child instanceof HTMLElement) {
          traverse(child);
        }
      });
    }
    traverse(node);
    return fonts;
  }
  async function getWebFontCSS(node, options) {
    const rules = await parseWebFontRules(node, options);
    const usedFonts = getUsedFonts(node);
    const cssTexts = await Promise.all(rules.filter((rule) => usedFonts.has(normalizeFontFamily(rule.style.fontFamily))).map((rule) => {
      const baseUrl = rule.parentStyleSheet ? rule.parentStyleSheet.href : null;
      return embedResources(rule.cssText, baseUrl, options);
    }));
    return cssTexts.join("\n");
  }
  async function embedWebFonts(clonedNode, options) {
    const cssText = options.fontEmbedCSS != null ? options.fontEmbedCSS : options.skipFonts ? null : await getWebFontCSS(clonedNode, options);
    if (cssText) {
      const styleNode = document.createElement("style");
      const sytleContent = document.createTextNode(cssText);
      styleNode.appendChild(sytleContent);
      if (clonedNode.firstChild) {
        clonedNode.insertBefore(styleNode, clonedNode.firstChild);
      } else {
        clonedNode.appendChild(styleNode);
      }
    }
  }

  // ../../node_modules/html-to-image/es/index.js
  async function toSvg(node, options = {}) {
    const { width, height } = getImageSize(node, options);
    const clonedNode = await cloneNode(node, options, true);
    await embedWebFonts(clonedNode, options);
    await embedImages(clonedNode, options);
    applyStyle(clonedNode, options);
    const datauri = await nodeToDataURL(clonedNode, width, height);
    return datauri;
  }
  async function toCanvas(node, options = {}) {
    const { width, height } = getImageSize(node, options);
    const svg = await toSvg(node, options);
    const img = await createImage(svg);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const ratio = options.pixelRatio || getPixelRatio();
    const canvasWidth = options.canvasWidth || width;
    const canvasHeight = options.canvasHeight || height;
    canvas.width = canvasWidth * ratio;
    canvas.height = canvasHeight * ratio;
    if (!options.skipAutoScale) {
      checkCanvasDimensions(canvas);
    }
    canvas.style.width = `${canvasWidth}`;
    canvas.style.height = `${canvasHeight}`;
    if (options.backgroundColor) {
      context.fillStyle = options.backgroundColor;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  async function toJpeg(node, options = {}) {
    const canvas = await toCanvas(node, options);
    return canvas.toDataURL("image/jpeg", options.quality || 1);
  }

  // src/overlay.js
  if (window.__pinpointLoaded) {
  } else {
    window.__pinpointLoaded = true;
    init();
  }
  function init() {
    const cfg = readConfig();
    const base = `http://127.0.0.1:${cfg.port}`;
    const token = cfg.token;
    const TASKS_KEY = "pinpoint.tasks";
    const SOFT_LIMIT = 8;
    const host = document.createElement("div");
    host.id = "__pinpoint_host";
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0;";
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

      /* Floating toggle button */
      .fab {
        position: fixed; bottom: 20px; right: 20px;
        width: 48px; height: 48px; border-radius: 50%;
        background: #10b981; color: #fff; border: none; cursor: pointer;
        box-shadow: 0 4px 14px rgba(0,0,0,.25);
        display: flex; align-items: center; justify-content: center;
        font-size: 20px; line-height: 1; z-index: 2147483647;
        transition: background .15s, transform .15s;
      }
      .fab:hover { transform: scale(1.05); }
      .fab.active { background: #ef4444; }

      /* Hover highlight box drawn over the target element */
      .highlight {
        position: fixed; pointer-events: none; z-index: 2147483646;
        border: 2px solid #10b981; background: rgba(16,185,129,.12);
        border-radius: 2px; display: none;
        box-shadow: 0 0 0 1px rgba(0,0,0,.15);
      }

      /* Panel */
      .panel {
        position: fixed; bottom: 80px; right: 20px; width: 340px;
        max-height: calc(100vh - 110px);
        background: #fff; color: #111; border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0,0,0,.28);
        z-index: 2147483647; display: none;
        border: 1px solid rgba(0,0,0,.08);
        overflow: hidden;
        flex-direction: column;
      }
      .panel.open { display: flex; }

      .hd {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px; border-bottom: 1px solid #eef0f2;
      }
      .hd .ttl { font-size: 13px; font-weight: 700; color: #111; flex: 0 0 auto; }
      .hd .spacer { flex: 1 1 auto; }
      .pick-toggle {
        border: 1px solid #d1d5db; background: #fff; color: #374151;
        border-radius: 999px; padding: 4px 10px; font-size: 11px; cursor: pointer;
        font-weight: 600;
      }
      .pick-toggle.on { background: #10b981; border-color: #10b981; color: #fff; }
      .hd .x {
        border: none; background: transparent; color: #9ca3af; cursor: pointer;
        font-size: 15px; line-height: 1; padding: 2px 4px;
      }
      .hd .x:hover { color: #374151; }

      .body { overflow-y: auto; padding: 12px; }

      /* Cart */
      .cart-count { font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 6px; }
      .cart-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
      .cart-empty {
        font-size: 12px; color: #9ca3af; padding: 10px; text-align: center;
        border: 1px dashed #e5e7eb; border-radius: 8px;
      }
      .cart-item {
        display: flex; align-items: center; gap: 8px;
        background: #f9fafb; border: 1px solid #eef0f2; border-radius: 8px;
        padding: 6px 8px;
      }
      .cart-item .idx {
        flex: 0 0 auto; width: 18px; height: 18px; border-radius: 50%;
        background: #10b981; color: #fff; font-size: 10px; font-weight: 700;
        display: flex; align-items: center; justify-content: center;
      }
      .cart-item .meta { flex: 1 1 auto; min-width: 0; }
      .cart-item .sel {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px; color: #374151; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
      }
      .cart-item .sub { font-size: 10px; color: #9ca3af; }
      .cart-item .rm {
        flex: 0 0 auto; border: none; background: transparent; color: #9ca3af;
        cursor: pointer; font-size: 14px; line-height: 1; padding: 2px 4px;
      }
      .cart-item .rm:hover { color: #ef4444; }

      textarea.task {
        width: 100%; min-height: 72px; resize: vertical;
        border: 1px solid #d1d5db; border-radius: 8px; padding: 8px;
        font-size: 13px; color: #111; outline: none; font-family: inherit;
      }
      textarea.task:focus { border-color: #10b981; }

      .row { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }
      .btn {
        border: none; border-radius: 8px; padding: 7px 14px;
        font-size: 13px; cursor: pointer; font-weight: 600;
      }
      .btn-primary { background: #10b981; color: #fff; }
      .btn-primary:disabled { opacity: .5; cursor: default; }
      .btn-ghost { background: #f3f4f6; color: #374151; }

      /* History */
      .hist-sec { border-top: 1px solid #eef0f2; margin-top: 12px; padding-top: 10px; }
      .hist-title { font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
      .hist-empty { font-size: 12px; color: #9ca3af; }
      .hist-list { display: flex; flex-direction: column; gap: 8px; }
      .hist-row { border: 1px solid #eef0f2; border-radius: 8px; padding: 8px; }
      .hist-main { display: flex; align-items: center; gap: 8px; }
      .badge {
        flex: 0 0 auto; font-size: 10px; font-weight: 700; border-radius: 999px;
        padding: 2px 8px; text-transform: uppercase; letter-spacing: .03em;
      }
      .badge-queued  { background: #f3f4f6; color: #6b7280; }
      .badge-working { background: #fef3c7; color: #b45309; }
      .badge-done    { background: #d1fae5; color: #047857; }
      .badge-blocked { background: #fee2e2; color: #b91c1c; }
      .hist-note { flex: 1 1 auto; min-width: 0; font-size: 12px; color: #374151;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .hist-id { color: #9ca3af; font-weight: 600; }
      .hist-fu { display: flex; gap: 6px; margin-top: 8px; }
      .hist-fu input {
        flex: 1 1 auto; min-width: 0; border: 1px solid #e5e7eb; border-radius: 6px;
        padding: 5px 8px; font-size: 12px; color: #111; outline: none; font-family: inherit;
      }
      .hist-fu input:focus { border-color: #10b981; }
      .btn-fu {
        flex: 0 0 auto; border: none; background: #f3f4f6; color: #374151;
        border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; font-weight: 700;
      }
      .btn-fu:hover { background: #e5e7eb; }

      /* Toast */
      .toast {
        position: fixed; bottom: 80px; right: 20px;
        background: #111; color: #fff; padding: 10px 16px; border-radius: 8px;
        font-size: 13px; z-index: 2147483647; opacity: 0;
        transition: opacity .2s; pointer-events: none;
        box-shadow: 0 4px 14px rgba(0,0,0,.3); max-width: 320px;
      }
      .toast.show { opacity: 1; }
      .toast.err { background: #b91c1c; }
      .toast.warn { background: #b45309; }
    </style>

    <button class="fab" title="Annotieren (Cmd/Ctrl+Shift+K)">\u25CE</button>
    <div class="highlight"></div>

    <div class="panel">
      <div class="hd">
        <span class="ttl">Pinpoint</span>
        <span class="spacer"></span>
        <button class="pick-toggle" data-act="toggle-pick">Auswahl: AUS</button>
        <button class="x" data-act="close" title="Schlie\xDFen">\u2715</button>
      </div>
      <div class="body">
        <div class="cart-count"></div>
        <div class="cart-list"></div>
        <textarea class="task" placeholder="Was soll an diesen Elementen passieren? \u2026"></textarea>
        <div class="row">
          <button class="btn btn-ghost" data-act="cancel">Abbrechen</button>
          <button class="btn btn-primary" data-act="send">Task senden (0)</button>
        </div>

        <div class="hist-sec">
          <div class="hist-title">Verlauf</div>
          <div class="hist-list"></div>
        </div>
      </div>
    </div>

    <div class="toast"></div>
  `;
    const fab = root.querySelector(".fab");
    const highlight = root.querySelector(".highlight");
    const panel = root.querySelector(".panel");
    const pickToggle = root.querySelector('[data-act="toggle-pick"]');
    const cartCountEl = root.querySelector(".cart-count");
    const cartListEl = root.querySelector(".cart-list");
    const textarea = root.querySelector("textarea.task");
    const sendBtn = root.querySelector('[data-act="send"]');
    const cancelBtn = root.querySelector('[data-act="cancel"]');
    const closeBtn = root.querySelector('[data-act="close"]');
    const histListEl = root.querySelector(".hist-list");
    const toastEl = root.querySelector(".toast");
    let picking = false;
    let sending = false;
    let uidSeq = 0;
    let cart = [];
    let tasks = loadTasks();
    function isOpen() {
      return panel.classList.contains("open");
    }
    function openPanel() {
      panel.classList.add("open");
      renderAll();
      setPicking(true);
    }
    function closePanel() {
      panel.classList.remove("open");
      setPicking(false);
    }
    function togglePanel() {
      if (isOpen()) closePanel();
      else openPanel();
    }
    function setPicking(on) {
      picking = on;
      fab.classList.toggle("active", on);
      fab.textContent = on ? "\u2715" : "\u25CE";
      pickToggle.classList.toggle("on", on);
      pickToggle.textContent = on ? "Auswahl: AN" : "Auswahl: AUS";
      document.documentElement.style.cursor = on ? "crosshair" : "";
      if (!on) hideHighlight();
    }
    function hideHighlight() {
      highlight.style.display = "none";
    }
    function isOurs(node) {
      return node === host || node && node.nodeType === 1 && host.contains(node);
    }
    function onMouseMove(e) {
      if (!picking) return;
      const el = elementUnderCursor(e.clientX, e.clientY);
      if (!el) {
        hideHighlight();
        return;
      }
      const r = el.getBoundingClientRect();
      highlight.style.display = "block";
      highlight.style.left = `${r.left}px`;
      highlight.style.top = `${r.top}px`;
      highlight.style.width = `${r.width}px`;
      highlight.style.height = `${r.height}px`;
    }
    function elementUnderCursor(x, y) {
      const prev = host.style.pointerEvents;
      host.style.pointerEvents = "none";
      const el = document.elementFromPoint(x, y);
      host.style.pointerEvents = prev;
      if (!el || isOurs(el)) return null;
      return el;
    }
    function onClickCapture(e) {
      if (!picking) return;
      if (e.composedPath && e.composedPath().includes(host)) return;
      const el = elementUnderCursor(e.clientX, e.clientY);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      addToCart(el);
    }
    function addToCart(el) {
      const r = el.getBoundingClientRect();
      const item = {
        uid: ++uidSeq,
        selector: safeSelector(el),
        url: location.href,
        title: document.title,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height)
        },
        domPath: buildDomPath(el),
        outerHtml: (el.outerHTML || "").slice(0, 2e3),
        sourceHint: el.closest("[data-v-inspector]")?.getAttribute("data-v-inspector") || void 0,
        screenshot: null,
        capturing: true
      };
      cart.push(item);
      renderCart();
      if (cart.length > SOFT_LIMIT) {
        toast(`Viele Elemente (${cart.length}) \u2014 ggf. in mehrere Tasks aufteilen`, "warn");
      }
      captureScreenshot(el).then((shot) => {
        const live = cart.find((c) => c.uid === item.uid);
        if (!live) return;
        live.screenshot = shot || null;
        live.capturing = false;
        renderCart();
      });
    }
    function removeFromCart(uid) {
      cart = cart.filter((c) => c.uid !== uid);
      renderCart();
    }
    function clearCart() {
      cart = [];
      renderCart();
    }
    function renderCart() {
      const n = cart.length;
      cartCountEl.textContent = n === 1 ? "1 Element" : `${n} Elemente`;
      sendBtn.textContent = `Task senden (${n})`;
      sendBtn.disabled = sending || n === 0;
      if (n === 0) {
        cartListEl.innerHTML = '<div class="cart-empty">Auswahl-Modus aktiv \u2014 klicke Elemente auf der Seite an.</div>';
        return;
      }
      cartListEl.innerHTML = cart.map((c, i) => {
        const sub = c.capturing ? "Screenshot \u2026" : c.screenshot ? "Screenshot \u2713" : "kein Screenshot";
        return `
          <div class="cart-item" data-uid="${c.uid}">
            <span class="idx">${i + 1}</span>
            <span class="meta">
              <span class="sel">${escapeHtml(c.selector)}</span>
              <span class="sub">${sub}</span>
            </span>
            <button class="rm" data-uid="${c.uid}" title="Entfernen">\u2715</button>
          </div>`;
      }).join("");
    }
    async function captureScreenshot(el) {
      try {
        const shot = toJpeg(el, {
          quality: 0.85,
          // Don't fetch/inline @font-face web fonts: on a real app that spams the
          // host console with 404s for no meaningful gain in an annotation shot.
          skipFonts: true,
          // Skip our own overlay nodes if html-to-image ever walks up to them.
          filter: (node) => !isOurs(node)
        });
        const guard = new Promise((resolve) => setTimeout(() => resolve(null), 4e3));
        return await Promise.race([shot, guard]);
      } catch {
        return null;
      }
    }
    async function send() {
      if (sending) return;
      if (cart.length === 0) return;
      const taskText = textarea.value.trim();
      if (!taskText) {
        textarea.focus();
        toast("Bitte eine Aufgabe eingeben", "warn");
        return;
      }
      sending = true;
      sendBtn.disabled = true;
      sendBtn.textContent = "Sende \u2026";
      const items = cart.map((c) => ({
        selector: c.selector,
        url: c.url,
        title: c.title,
        viewport: c.viewport,
        rect: c.rect,
        domPath: c.domPath,
        outerHtml: c.outerHtml,
        sourceHint: c.sourceHint,
        screenshot: c.screenshot || void 0
      }));
      try {
        const res = await fetch(`${base}/annotation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Pinpoint-Token": token
          },
          body: JSON.stringify({ task: taskText, items })
        });
        if (res.ok) {
          let taskId = "";
          try {
            const body = await res.json();
            taskId = body && body.task_id != null ? String(body.task_id) : "";
          } catch {
          }
          tasks.unshift({
            id: taskId,
            note: taskText,
            count: items.length,
            status: "queued",
            ts: Date.now()
          });
          saveTasks();
          clearCart();
          textarea.value = "";
          setPicking(false);
          renderHistory();
          toast(`\u2713 Task #${taskId || "?"} gesendet (${items.length})`);
        } else {
          toast(`Fehler: ${res.status}`, "err");
        }
      } catch {
        toast("Senden fehlgeschlagen", "err");
      } finally {
        sending = false;
        renderCart();
      }
    }
    function renderHistory() {
      if (!tasks.length) {
        histListEl.innerHTML = '<div class="hist-empty">Noch keine Tasks gesendet.</div>';
        return;
      }
      histListEl.innerHTML = tasks.map((t) => {
        const status = normalizeStatus(t.status);
        const idLabel = t.id ? `#${escapeHtml(String(t.id))} ` : "";
        return `
          <div class="hist-row" data-id="${escapeHtml(String(t.id))}">
            <div class="hist-main">
              <span class="badge badge-${status}">${status}</span>
              <span class="hist-note"><span class="hist-id">${idLabel}</span>${escapeHtml(t.note || "")}</span>
            </div>
            <div class="hist-fu">
              <input type="text" placeholder="Follow-up \u2026" data-id="${escapeHtml(String(t.id))}" />
              <button class="btn-fu" data-id="${escapeHtml(String(t.id))}" title="Follow-up senden">\u2192</button>
            </div>
          </div>`;
      }).join("");
    }
    async function sendFollowup(taskId, text, inputEl) {
      const body = (text || "").trim();
      if (!taskId || !body) return;
      try {
        const res = await fetch(`${base}/followup`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Pinpoint-Token": token
          },
          body: JSON.stringify({ task_id: String(taskId), text: body })
        });
        if (res.ok) {
          if (inputEl) inputEl.value = "";
          toast(`\u2713 Follow-up zu #${taskId} gesendet`);
        } else {
          toast(`Fehler: ${res.status}`, "err");
        }
      } catch {
        toast("Follow-up fehlgeschlagen", "err");
      }
    }
    function renderAll() {
      renderCart();
      renderHistory();
    }
    function connectStatus() {
      let es;
      try {
        es = new EventSource(`${base}/events`);
      } catch {
        return;
      }
      es.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!msg || msg.type !== "status" || msg.task_id == null) return;
        const t = tasks.find((x) => String(x.id) === String(msg.task_id));
        if (!t) return;
        t.status = normalizeStatus(msg.status);
        if (typeof msg.note === "string" && msg.note) t.statusNote = msg.note;
        saveTasks();
        renderHistory();
      };
      es.onerror = () => {
      };
    }
    function loadTasks() {
      try {
        const raw = localStorage.getItem(TASKS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    }
    function saveTasks() {
      try {
        if (tasks.length > 50) tasks = tasks.slice(0, 50);
        localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
      } catch {
      }
    }
    function normalizeStatus(s) {
      const v = String(s || "").toLowerCase();
      return v === "working" || v === "done" || v === "blocked" ? v : "queued";
    }
    function safeSelector(el) {
      try {
        return finder(el);
      } catch {
        return simplePath(el);
      }
    }
    function simplePath(el) {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== document.body) {
        const tag = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (parent) {
          const idx = Array.prototype.indexOf.call(parent.children, node) + 1;
          parts.unshift(`${tag}:nth-child(${idx})`);
        } else {
          parts.unshift(tag);
        }
        node = parent;
      }
      parts.unshift("body");
      return parts.join(" > ");
    }
    function buildDomPath(el) {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1) {
        let seg = node.tagName.toLowerCase();
        if (node.classList && node.classList.length) {
          const cls = Array.prototype.find.call(
            node.classList,
            (c) => /^[a-zA-Z][\w-]*$/.test(c)
          );
          if (cls) seg += `.${cls}`;
        }
        parts.unshift(seg);
        if (node === document.body) break;
        node = node.parentElement;
      }
      return parts.join(" > ");
    }
    function escapeHtml(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    let toastTimer = null;
    function toast(msg, kind) {
      toastEl.textContent = msg;
      toastEl.classList.remove("err", "warn");
      if (kind === "err") toastEl.classList.add("err");
      else if (kind === "warn") toastEl.classList.add("warn");
      toastEl.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
    }
    fab.addEventListener("click", togglePanel);
    closeBtn.addEventListener("click", closePanel);
    pickToggle.addEventListener("click", () => setPicking(!picking));
    cancelBtn.addEventListener("click", clearCart);
    sendBtn.addEventListener("click", send);
    cartListEl.addEventListener("click", (e) => {
      const rm = e.target.closest(".rm");
      if (!rm) return;
      const uid = Number(rm.getAttribute("data-uid"));
      if (uid) removeFromCart(uid);
    });
    histListEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-fu");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const input = histListEl.querySelector(`.hist-fu input[data-id="${cssEscape(id)}"]`);
      sendFollowup(id, input ? input.value : "", input);
    });
    histListEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const input = e.target.closest(".hist-fu input");
      if (!input) return;
      e.preventDefault();
      sendFollowup(input.getAttribute("data-id"), input.value, input);
    });
    textarea.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        send();
      } else if (e.key === "Escape") {
        closePanel();
      }
    });
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("click", onClickCapture, true);
    window.addEventListener("scroll", hideHighlight, true);
    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        togglePanel();
      }
    }, true);
    function cssEscape(v) {
      const s = String(v);
      if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(s);
      return s.replace(/["\\\]]/g, "\\$&");
    }
    connectStatus();
  }
  function readConfig() {
    const ds = document.getElementById("pinpoint-overlay")?.dataset;
    if (ds && ds.pinpointPort) {
      return { port: Number(ds.pinpointPort) || 4849, token: ds.pinpointToken || "" };
    }
    if (window.__PINPOINT__ && window.__PINPOINT__.port) {
      return { port: Number(window.__PINPOINT__.port) || 4849, token: window.__PINPOINT__.token || "" };
    }
    return { port: 4849, token: "" };
  }
})();
