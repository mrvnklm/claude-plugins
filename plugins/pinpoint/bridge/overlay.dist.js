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
    const hostLabel = `127.0.0.1:${cfg.port}`;
    const TASKS_KEY = "pinpoint.tasks";
    const SOFT_LIMIT = 8;
    const host = document.createElement("div");
    host.id = "__pinpoint_host";
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0;";
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
    <style>
      /* ===================================================================
         Design tokens \u2014 light-first, dark via prefers-color-scheme.
         Fonts use graceful stacks (NO external <link>: we never fetch web
         fonts \u2014 captures use skipFonts:true and the constraint forbids it).
         =================================================================== */
      :host {
        all: initial;

        --pp-sans: 'IBM Plex Sans', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        --pp-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

        /* surfaces + ink */
        --pp-paper: #FBFBF9;
        --pp-sub: #F0F0EC;
        --pp-ink: #14161C;
        --pp-text: #14161C;
        --pp-field: #ffffff;

        /* muted text */
        --pp-muted: rgba(20,22,28,.55);
        --pp-muted-2: rgba(20,22,28,.4);

        /* accent (teal) */
        --pp-accent: #0D9488;
        --pp-accent-soft: #DDF0EE;
        --pp-accent-soft-2: #E3F3F1;
        --pp-accent-glow: rgba(13,148,136,.3);
        --pp-on-accent: #ffffff;

        /* borders / hairlines */
        --pp-border: rgba(20,22,28,.14);
        --pp-border-10: rgba(20,22,28,.10);
        --pp-border-08: rgba(20,22,28,.08);

        /* elevation */
        --pp-shadow-panel: 0 8px 28px rgba(20,22,28,.16);
        --pp-shadow-float: 0 6px 22px rgba(20,22,28,.12);
        --pp-shadow-btn: 0 2px 10px rgba(13,148,136,.3);

        /* segmented control active pill */
        --pp-seg-fg: rgba(20,22,28,.55);
        --pp-seg-active-bg: #14161C;
        --pp-seg-active-fg: #ffffff;

        /* status dots + soft callout backgrounds */
        --pp-st-queued: #64748B;   --pp-st-queued-bg: #F0F0EC;
        --pp-st-working: #B45309;  --pp-st-working-bg: #FBEFDD;
        --pp-st-done: #15803D;     --pp-st-done-bg: #E4F3E9;
        --pp-st-blocked: #DC2626;  --pp-st-blocked-bg: #FBE7E7;

        /* history expanded tint + flag */
        --pp-hist-exp: #EFF9F7;
        --pp-flag-bg: #14161C;
        --pp-flag-fg: #ffffff;

        /* toast */
        --pp-toast-bg: #14161C;
        --pp-toast-fg: #ffffff;
        --pp-toast-ok: #34D3B8;
        --pp-toast-warn: #F5B041;
        --pp-toast-err: #F87171;

        /* thumbnail placeholder stripe */
        --pp-stripe: repeating-linear-gradient(135deg,#F0F0EC 0 5px,#E4E4DE 5px 10px);
      }

      @media (prefers-color-scheme: dark) {
        :host {
          --pp-paper: #101219;
          --pp-sub: #171922;
          --pp-ink: #F0F0EC;
          --pp-text: #E7E7E3;
          --pp-field: #1a1d27;

          --pp-muted: rgba(255,255,255,.55);
          --pp-muted-2: rgba(255,255,255,.4);

          --pp-accent: #34D3B8;
          --pp-accent-soft: rgba(52,211,184,.16);
          --pp-accent-soft-2: rgba(52,211,184,.12);
          --pp-accent-glow: rgba(52,211,184,.32);
          --pp-on-accent: #06231f;

          --pp-border: rgba(255,255,255,.12);
          --pp-border-10: rgba(255,255,255,.10);
          --pp-border-08: rgba(255,255,255,.07);

          --pp-shadow-panel: 0 8px 28px rgba(0,0,0,.5);
          --pp-shadow-float: 0 6px 22px rgba(0,0,0,.45);
          --pp-shadow-btn: 0 2px 10px rgba(52,211,184,.28);

          --pp-seg-fg: rgba(255,255,255,.55);
          --pp-seg-active-bg: rgba(255,255,255,.14);
          --pp-seg-active-fg: #F0F0EC;

          --pp-st-queued: #94A3B8;   --pp-st-queued-bg: rgba(148,163,184,.14);
          --pp-st-working: #F5B041;  --pp-st-working-bg: rgba(245,176,65,.14);
          --pp-st-done: #5FD38B;     --pp-st-done-bg: rgba(95,211,139,.14);
          --pp-st-blocked: #F87171;  --pp-st-blocked-bg: rgba(248,113,113,.14);

          --pp-hist-exp: rgba(52,211,184,.08);
          --pp-flag-bg: #1b1e29;
          --pp-flag-fg: #F0F0EC;

          --pp-stripe: repeating-linear-gradient(135deg,#242736 0 5px,#20232f 5px 10px);
        }
      }

      * {
        box-sizing: border-box;
        font-family: var(--pp-sans);
      }

      /* ===================================================================
         Edge launcher FLAG \u2014 dark ink vertical tab flush to the edge, rounded
         outer corners, a thin teal accent strip, a vertical "PINPOINT" label.
         Draggable up/down; drag across snaps to the other edge; a plain click
         (below the drag threshold) toggles the panel. Offsets set by positionTab().
         =================================================================== */
      .tab {
        position: fixed;
        width: 28px; height: 104px;
        background: var(--pp-flag-bg); color: var(--pp-flag-fg);
        border: none; cursor: grab; padding: 0;
        box-shadow: 0 3px 12px rgba(20,22,28,.28);
        display: flex; align-items: center; justify-content: center;
        z-index: 2147483647;
        transition: box-shadow .15s, background .15s;
        /* prevent the browser from turning a vertical drag into a page scroll
           on touch, and stop text-selection while dragging */
        touch-action: none; user-select: none; -webkit-user-select: none;
      }
      .tab > * { pointer-events: none; }
      .tab.side-left  { left: 0;  border-radius: 0 6px 6px 0; }
      .tab.side-right { right: 0; border-radius: 6px 0 0 6px; }
      .tab:hover { box-shadow: 0 5px 16px rgba(20,22,28,.34); }
      .tab.dragging { cursor: grabbing; transition: none; opacity: .95; }
      /* the teal accent strip sits on the flush edge */
      .tab .tab-accent {
        position: absolute; top: 12px; width: 4px; height: 80px;
        background: var(--pp-accent); transition: top .15s, height .15s, background .15s;
      }
      .tab.side-left  .tab-accent { left: 0;  border-radius: 0 2px 2px 0; }
      .tab.side-right .tab-accent { right: 0; border-radius: 2px 0 0 2px; }
      .tab .tab-label {
        font: 600 9px var(--pp-mono); letter-spacing: .16em; color: var(--pp-flag-fg);
        writing-mode: vertical-rl; transform: rotate(180deg);
      }
      /* Active (picking) tint: the accent strip fills the full height + a teal glow. */
      .tab.active { box-shadow: 0 3px 16px var(--pp-accent-glow); }
      .tab.active .tab-accent { top: 0; height: 100%; }

      /* ===================================================================
         Transient hover highlight box (dashed teal outline + soft fill + a
         selector label chip) drawn over the element under the cursor.
         =================================================================== */
      .highlight {
        position: fixed; pointer-events: none; z-index: 2147483646;
        outline: 1px dashed var(--pp-accent); outline-offset: 2px;
        background: rgba(13,148,136,.16);
        border-radius: 3px; display: none;
      }
      .highlight .hl-chip {
        position: absolute; bottom: -18px; left: 0;
        background: var(--pp-ink); color: var(--pp-paper);
        font: 500 8px var(--pp-mono); padding: 2px 6px; border-radius: 3px;
        white-space: nowrap; max-width: 240px; overflow: hidden; text-overflow: ellipsis;
      }

      /* ===================================================================
         Persistent on-page highlight boxes for every cart item \u2014 a solid teal
         numbered outline; hovering the matching cart row emphasizes it (dashed
         + soft fill). Positioned via getBoundingClientRect each frame.
         =================================================================== */
      .cart-highlights { position: fixed; inset: 0; pointer-events: none; z-index: 2147483644; }
      .cart-hl {
        position: fixed; pointer-events: none; display: none;
        outline: 2px solid var(--pp-accent); outline-offset: 2px; border-radius: 2px;
        transition: background .1s, outline-color .1s;
      }
      .cart-hl .num {
        position: absolute; top: -9px; left: -2px;
        background: var(--pp-accent); color: var(--pp-on-accent);
        font: 700 9px var(--pp-mono); padding: 1px 5px; border-radius: 3px;
        box-shadow: 0 1px 3px rgba(20,22,28,.35);
      }
      .cart-hl.emph {
        outline-style: dashed; background: rgba(13,148,136,.18);
      }

      /* ===================================================================
         Panel \u2014 floating card (default) or docked right sidebar.
         =================================================================== */
      .panel {
        position: fixed; bottom: 80px; right: 20px;
        /* Never wider than the viewport (minus the 20px right + a small left gap). */
        width: min(340px, calc(100vw - 40px));
        max-height: calc(100vh - 110px);
        background: var(--pp-paper); color: var(--pp-text);
        border-radius: 6px; border: 1px solid var(--pp-border);
        box-shadow: var(--pp-shadow-panel);
        z-index: 2147483647; display: none;
        overflow: hidden; flex-direction: column;
      }
      .panel.open { display: flex; }

      /* Docked mode: full-height right sidebar. The page reflows via a
         margin/width set on <html> by updateLayout(); this styles the panel. */
      .panel.docked {
        top: 0; right: 0; bottom: auto; left: auto;
        width: 360px; height: 100vh; max-height: none;
        border-radius: 0; border: none;
        border-left: 1px solid var(--pp-border-10);
        box-shadow: none;
      }

      /* Header */
      .hd {
        position: relative;
        display: flex; align-items: center; gap: 8px;
        padding: 12px 14px; border-bottom: 1px solid var(--pp-border-10);
        flex: 0 0 auto;
      }
      .hd-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--pp-accent); flex: 0 0 auto; transition: background .15s;
      }
      .hd.offline .hd-dot { background: var(--pp-st-blocked); }
      .hd-ttl { font: 700 12px var(--pp-sans); letter-spacing: .02em; color: var(--pp-ink); }
      .hd-ver { font: 400 9px var(--pp-mono); color: var(--pp-muted-2); }
      .hd-offline {
        display: none; font: 500 8px var(--pp-mono); color: var(--pp-st-blocked);
        margin-left: 4px;
      }
      .hd.offline .hd-offline { display: inline; }
      .hd-ctrls { margin-left: auto; display: flex; gap: 2px; align-items: center; }
      .seg-btn {
        width: 26px; height: 26px; border: none; background: transparent; cursor: pointer;
        border-radius: 5px; color: var(--pp-seg-fg);
        font: 500 12px var(--pp-sans); display: flex; align-items: center; justify-content: center;
        padding: 0;
      }
      .seg-btn:hover { color: var(--pp-ink); }
      .seg-btn.active { background: var(--pp-seg-active-bg); color: var(--pp-seg-active-fg); }
      .hd-x {
        width: 26px; height: 26px; border: none; background: transparent; cursor: pointer;
        border-radius: 5px; color: var(--pp-seg-fg);
        font: 500 13px var(--pp-sans); display: flex; align-items: center; justify-content: center;
        padding: 0;
      }
      .hd-x:hover { color: var(--pp-ink); }

      /* Picking overlay: the whole header turns teal with "Picking\u2026" + ESC chip. */
      .hd-pick {
        position: absolute; inset: 0; display: none;
        align-items: center; gap: 8px; padding: 12px 14px;
        background: var(--pp-accent); color: var(--pp-on-accent);
      }
      .hd.picking .hd-pick { display: flex; }
      .hd-pick .pk-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pp-on-accent); flex: 0 0 auto; }
      .hd-pick .pk-ttl { font: 700 12px var(--pp-sans); letter-spacing: .02em; }
      .hd-pick .esc-chip {
        margin-left: auto; font: 600 10px var(--pp-mono); border-radius: 4px;
        padding: 3px 9px; background: rgba(255,255,255,.2); color: var(--pp-on-accent);
        cursor: pointer;
      }

      /* Scroll body */
      .body { overflow-y: auto; flex: 1 1 auto; }

      /* Section frame */
      .sec { padding: 13px 14px; border-bottom: 1px solid var(--pp-border-10); }

      /* Offline banner */
      .offline-banner {
        display: none; margin: 13px 14px 0;
        background: var(--pp-st-blocked-bg); border-radius: 5px; padding: 9px 10px;
      }
      .offline-banner .ob-title { font: 600 10px var(--pp-sans); color: var(--pp-st-blocked); margin: 0 0 3px; }
      .offline-banner .ob-sub { font: 400 9px var(--pp-mono); color: var(--pp-st-blocked); opacity: .9; margin: 0; }
      .offline-banner .ob-retry { opacity: .7; }

      /* Primary pick button */
      .pick-btn {
        width: 100%; height: 42px; background: var(--pp-accent); color: var(--pp-on-accent);
        border: none; border-radius: 6px; cursor: pointer;
        font: 600 12px var(--pp-sans); letter-spacing: .01em;
        box-shadow: var(--pp-shadow-btn);
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }
      .pick-btn:hover { filter: brightness(1.04); }
      .pick-btn.active { box-shadow: 0 0 0 2px var(--pp-accent-glow), var(--pp-shadow-btn); }
      .pick-glyph { font-size: 14px; line-height: 1; }
      .pick-help {
        display: none; font: 400 10px/1.6 var(--pp-sans); color: var(--pp-muted);
        margin: 12px 0 0; text-align: center;
      }

      /* Cart section */
      .cart-hd { display: flex; align-items: center; padding: 0 0 9px; }
      .cart-hd .cart-lbl { font: 600 10px var(--pp-sans); letter-spacing: .02em; color: var(--pp-muted); }
      .cart-hd .cart-pill {
        margin-left: auto; font: 600 9px var(--pp-sans); color: var(--pp-accent);
        background: var(--pp-accent-soft); border-radius: 20px; padding: 3px 10px;
      }
      .cart-list { display: flex; flex-direction: column; }
      .cart-empty {
        text-align: center; padding: 14px 6px 4px;
      }
      .cart-empty .ce-glyph {
        width: 34px; height: 34px; margin: 0 auto 12px;
        border: 1.5px dashed var(--pp-border); border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font: 400 15px var(--pp-sans); color: var(--pp-muted-2);
      }
      .cart-empty .ce-title { font: 600 11px var(--pp-sans); color: var(--pp-ink); margin: 0 0 4px; }
      .cart-empty .ce-sub { font: 400 9.5px/1.5 var(--pp-sans); color: var(--pp-muted); margin: 0; }

      /* Cart row: [idx] [52x34 thumb] [selector (flex, ellipsis)] [remove \u2715].
         The \u2715 is flex:none so a long selector can never overlap it. */
      .cart-item {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 0; border-bottom: 1px solid var(--pp-border-08);
      }
      .cart-item:last-child { border-bottom: none; }
      .ci-idx {
        flex: 0 0 auto; width: 20px; height: 20px;
        background: var(--pp-accent-soft); color: var(--pp-accent); border-radius: 5px;
        font: 700 10px var(--pp-sans); display: flex; align-items: center; justify-content: center;
      }
      .ci-thumb-wrap { flex: 0 0 auto; width: 52px; height: 34px; border-radius: 4px; overflow: hidden; }
      .ci-thumb { width: 52px; height: 34px; object-fit: cover; display: block; }
      .ci-thumb.placeholder {
        width: 52px; height: 34px; background: var(--pp-stripe);
        display: flex; align-items: center; justify-content: center;
        color: var(--pp-muted-2); font-size: 11px;
      }
      .ci-sel {
        flex: 1 1 auto; min-width: 0; font: 500 10px var(--pp-mono); color: var(--pp-text);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .ci-rm {
        flex: 0 0 auto; width: 24px; height: 24px; border: none; background: transparent;
        border-radius: 5px; color: var(--pp-muted); cursor: pointer;
        font: 500 12px var(--pp-sans); display: flex; align-items: center; justify-content: center;
        padding: 0;
      }
      .ci-rm:hover { color: var(--pp-st-blocked); }

      /* Compose */
      textarea.task {
        width: 100%; min-height: 70px; resize: vertical;
        border: 1px solid var(--pp-border); border-radius: 5px; background: var(--pp-field);
        padding: 9px; font: 400 11px/1.5 var(--pp-sans); color: var(--pp-text); outline: none;
      }
      textarea.task:focus { border-color: var(--pp-accent); }
      .compose-row { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
      .compose-hint { font: 400 8.5px var(--pp-mono); color: var(--pp-muted-2); }
      .send-btn {
        margin-left: auto; height: 38px; padding: 0 16px;
        background: var(--pp-accent); color: var(--pp-on-accent); border: none; border-radius: 5px;
        font: 600 11px var(--pp-sans); cursor: pointer; box-shadow: var(--pp-shadow-btn);
      }
      .send-btn:hover:not(:disabled) { filter: brightness(1.04); }
      .send-btn:disabled { background: var(--pp-sub); color: var(--pp-muted-2); box-shadow: none; cursor: not-allowed; }
      .compose-queued {
        display: none; font: 400 8.5px/1.5 var(--pp-sans); color: var(--pp-muted);
        margin: 10px 0 0; text-align: center;
      }

      /* History */
      .hist-hd { display: flex; align-items: center; padding: 0 0 4px; }
      .hist-hd .hist-lbl { font: 600 10px var(--pp-sans); color: var(--pp-muted); }
      .hist-hd .hist-cnt { margin-left: auto; font: 400 9px var(--pp-mono); color: var(--pp-muted-2); }
      .hist-empty {
        font: 400 8.5px var(--pp-mono); color: var(--pp-muted-2);
        text-align: center; padding: 12px 0 4px;
      }
      .hist-list { display: flex; flex-direction: column; }

      .hist-row { border-bottom: 1px solid var(--pp-border-08); }
      .hist-row:last-child { border-bottom: none; }
      .hist-row[data-expanded="1"] { background: var(--pp-hist-exp); }

      .hist-head {
        display: flex; align-items: center; gap: 10px;
        padding: 11px 0; cursor: pointer; user-select: none; -webkit-user-select: none;
      }
      .hist-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--pp-st-queued); }
      .hist-dot.dot-queued  { background: var(--pp-st-queued); }
      .hist-dot.dot-working { background: var(--pp-st-working); }
      .hist-dot.dot-done    { background: var(--pp-st-done); }
      .hist-dot.dot-blocked { background: var(--pp-st-blocked); }
      .hist-note-1 {
        flex: 1 1 auto; min-width: 0; font: 500 10px var(--pp-sans); color: var(--pp-text);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .hist-id { color: var(--pp-muted-2); font-family: var(--pp-mono); }
      .hist-time { flex: 0 0 auto; font: 400 9px var(--pp-mono); color: var(--pp-muted-2); }
      .hist-chevron {
        flex: 0 0 auto; font: 500 10px var(--pp-sans); color: var(--pp-muted-2);
        transition: transform .2s ease, color .2s ease;
      }
      .hist-row[data-expanded="1"] .hist-chevron { transform: rotate(90deg); color: var(--pp-accent); }

      /* Expanded detail \u2014 smooth grid-rows disclosure (0fr \u2192 1fr). */
      .hist-detail { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .2s ease; }
      .hist-row[data-expanded="1"] .hist-detail { grid-template-rows: 1fr; }
      .hist-detail-inner { overflow: hidden; min-height: 0; }
      .hist-detail-pad { padding: 0 0 13px 17px; display: flex; flex-direction: column; gap: 8px; }

      .hist-note-full {
        font: 400 10px/1.6 var(--pp-sans); color: var(--pp-text);
        overflow-wrap: anywhere; white-space: pre-wrap; margin: 0;
      }
      .hist-note-full.clamp {
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden; white-space: normal;
      }
      .hist-note-more {
        display: none; font: 500 9px var(--pp-sans); color: var(--pp-accent); cursor: pointer;
        margin-top: 2px;
      }

      /* statusNote callout \u2014 colored by status. */
      .hist-status { border-radius: 5px; padding: 7px 9px; font: 500 9px/1.5 var(--pp-sans); overflow-wrap: anywhere; }
      .hist-status.st-queued  { background: var(--pp-st-queued-bg);  color: var(--pp-st-queued); }
      .hist-status.st-working { background: var(--pp-st-working-bg); color: var(--pp-st-working); }
      .hist-status.st-done    { background: var(--pp-st-done-bg);    color: var(--pp-st-done); }
      .hist-status.st-blocked { background: var(--pp-st-blocked-bg); color: var(--pp-st-blocked); }

      /* Per-element thumbs + selectors. */
      .hist-els { display: flex; flex-wrap: wrap; gap: 8px; }
      .hist-el { flex: 1 1 calc(50% - 4px); min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .hist-el-img {
        width: 100%; height: 42px; object-fit: cover; display: block;
        border-radius: 5px; border: 1px solid var(--pp-border-08); background: var(--pp-sub);
      }
      .hist-el-img.placeholder {
        display: flex; align-items: center; justify-content: center;
        color: var(--pp-muted-2); font-size: 13px;
      }
      .hist-el-sel {
        min-width: 0; font: 400 8.5px var(--pp-mono); color: var(--pp-muted);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      .hist-fu { display: flex; gap: 6px; }
      .hist-fu input {
        flex: 1 1 auto; min-width: 0; border: 1px solid var(--pp-border); border-radius: 6px;
        padding: 8px 10px; font: 400 10px var(--pp-sans); color: var(--pp-text);
        background: var(--pp-field); outline: none;
      }
      .hist-fu input:focus { border-color: var(--pp-accent); }
      .btn-fu {
        flex: 0 0 auto; width: 36px; border: none; background: var(--pp-ink); color: var(--pp-paper);
        border-radius: 6px; cursor: pointer; font: 500 13px var(--pp-sans);
        display: flex; align-items: center; justify-content: center;
      }
      .btn-fu:hover { filter: brightness(1.1); }

      /* Toast \u2014 dark ink pill, colored status dot, white text. */
      .toast {
        position: fixed; bottom: 80px; right: 20px;
        display: flex; align-items: center; gap: 9px;
        background: var(--pp-toast-bg); color: var(--pp-toast-fg);
        padding: 10px 12px; border-radius: 6px;
        z-index: 2147483647; opacity: 0; transition: opacity .2s; pointer-events: none;
        box-shadow: 0 6px 22px rgba(20,22,28,.3);
        max-width: min(320px, calc(100vw - 40px));
      }
      .toast.show { opacity: 1; }
      .toast .toast-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; background: var(--pp-toast-ok); }
      .toast .toast-msg { font: 500 10px var(--pp-sans); overflow-wrap: anywhere; }

      /* Keyboard focus \u2014 a visible AA ring on every interactive control. The
         2px offset drops the ring onto the surrounding paper (not the teal fill)
         so it stays legible even on the teal-filled Pick/Send buttons. Mouse
         users never see it (:focus-visible only). */
      .tab:focus-visible,
      .seg-btn:focus-visible,
      .hd-x:focus-visible,
      .esc-chip:focus-visible,
      .pick-btn:focus-visible,
      .send-btn:focus-visible,
      .ci-rm:focus-visible,
      .btn-fu:focus-visible,
      .hist-note-more:focus-visible {
        outline: 2px solid var(--pp-accent);
        outline-offset: 2px;
      }
      .hd-x:focus-visible, .seg-btn:focus-visible, .ci-rm:focus-visible {
        outline-offset: 1px;
      }

      @media (prefers-reduced-motion: reduce) {
        .hist-detail, .hist-chevron, .tab, .tab-accent, .hd-dot, .toast { transition: none; }
      }
    </style>

    <button class="tab side-left" title="Pinpoint \u2014 pick elements (Cmd/Ctrl+Shift+K) \xB7 drag to move" aria-label="Pinpoint launcher">
      <span class="tab-accent"></span>
      <span class="tab-label">PINPOINT</span>
    </button>
    <div class="highlight"><span class="hl-chip"></span></div>
    <div class="cart-highlights"></div>

    <div class="panel" role="dialog" aria-label="Pinpoint">
      <div class="hd">
        <span class="hd-dot"></span>
        <span class="hd-ttl">Pinpoint</span>
        <span class="hd-ver">v0.4</span>
        <span class="hd-offline">offline</span>
        <span class="hd-ctrls">
          <button class="seg-btn seg-float" data-act="float" title="Float" aria-label="Float panel">\u25A2</button>
          <button class="seg-btn seg-dock" data-act="dock" title="Dock" aria-label="Dock panel">\u25A4</button>
          <button class="hd-x" data-act="close" title="Close" aria-label="Close">\u2715</button>
        </span>
        <div class="hd-pick">
          <span class="pk-dot"></span>
          <span class="pk-ttl">Picking\u2026</span>
          <span class="esc-chip" data-act="stop-pick" role="button">ESC</span>
        </div>
      </div>

      <div class="body">
        <div class="offline-banner">
          <p class="ob-title">Bridge offline</p>
          <p class="ob-sub"><span class="ob-host"></span><span class="ob-retry"></span></p>
        </div>

        <div class="sec">
          <button class="pick-btn" data-act="pick" aria-pressed="false">
            <span class="pick-glyph">\uFF0B</span><span>Pick elements</span>
          </button>
          <p class="pick-help">Click any element on the page to attach it to a task.</p>
        </div>

        <div class="sec cart-sec">
          <div class="cart-hd">
            <span class="cart-lbl">Cart</span>
            <span class="cart-pill">0</span>
          </div>
          <div class="cart-list"></div>
        </div>

        <div class="sec compose-sec">
          <textarea class="task" placeholder="What should happen to these elements?"></textarea>
          <div class="compose-row">
            <span class="compose-hint">\u2318\u21B5 / \u21E7\u21B5 to send</span>
            <button class="send-btn" data-act="send">Send task (0) \u2192</button>
          </div>
          <p class="compose-queued">Queued locally \u2014 sends when the bridge is back.</p>
        </div>

        <div class="sec hist-sec" style="border-bottom:none">
          <div class="hist-hd">
            <span class="hist-lbl">History</span>
            <span class="hist-cnt"></span>
          </div>
          <div class="hist-list"></div>
        </div>
      </div>
    </div>

    <div class="toast"><span class="toast-dot"></span><span class="toast-msg"></span></div>
  `;
    const tab = root.querySelector(".tab");
    const highlight = root.querySelector(".highlight");
    const hlChip = root.querySelector(".highlight .hl-chip");
    const cartHlEl = root.querySelector(".cart-highlights");
    const panel = root.querySelector(".panel");
    const hdEl = root.querySelector(".hd");
    const pickBtn = root.querySelector('[data-act="pick"]');
    const pickHelpEl = root.querySelector(".pick-help");
    const floatBtn = root.querySelector('[data-act="float"]');
    const dockBtn = root.querySelector('[data-act="dock"]');
    const escChip = root.querySelector('[data-act="stop-pick"]');
    const cartPillEl = root.querySelector(".cart-pill");
    const cartListEl = root.querySelector(".cart-list");
    const textarea = root.querySelector("textarea.task");
    const sendBtn = root.querySelector('[data-act="send"]');
    const composeQueuedEl = root.querySelector(".compose-queued");
    const closeBtn = root.querySelector('[data-act="close"]');
    const histListEl = root.querySelector(".hist-list");
    const histCntEl = root.querySelector(".hist-cnt");
    const toastEl = root.querySelector(".toast");
    const toastDotEl = root.querySelector(".toast .toast-dot");
    const toastMsgEl = root.querySelector(".toast .toast-msg");
    const offlineBanner = root.querySelector(".offline-banner");
    const obHostEl = root.querySelector(".ob-host");
    const obRetryEl = root.querySelector(".ob-retry");
    const hdOfflineEl = root.querySelector(".hd-offline");
    const cs = getComputedStyle(host);
    const TOAST_OK = (cs.getPropertyValue("--pp-toast-ok") || "#34D3B8").trim();
    const TOAST_WARN = (cs.getPropertyValue("--pp-toast-warn") || "#F5B041").trim();
    const TOAST_ERR = (cs.getPropertyValue("--pp-toast-err") || "#F87171").trim();
    let picking = false;
    let sending = false;
    let uidSeq = 0;
    let cart = [];
    let tasks = loadTasks();
    const expandedRows = /* @__PURE__ */ new Set();
    let online = true;
    let retryCount = 0;
    const DOCK_KEY = "pinpoint.dock";
    const DOCK_WIDTH = 360;
    const MIN_CONTENT = 140;
    const NARROW_DOCK_MIN = DOCK_WIDTH + MIN_CONTENT;
    let dockMode = loadDock();
    function effectiveDock() {
      return dockMode === "dock" && window.innerWidth >= NARROW_DOCK_MIN;
    }
    const FAB_KEY = "pinpoint.fab";
    const TAB_H = 104;
    const DRAG_THRESHOLD = 5;
    let fabPos = loadFabPos();
    let dragState = null;
    function isOpen() {
      return panel.classList.contains("open");
    }
    function openPanel() {
      panel.classList.add("open");
      renderAll();
      setPicking(true);
      updateLayout();
    }
    function closePanel() {
      panel.classList.remove("open");
      setPicking(false);
      clearCartHighlights();
      updateLayout();
    }
    function togglePanel() {
      if (isOpen()) closePanel();
      else openPanel();
    }
    function setPicking(on) {
      picking = on;
      tab.classList.toggle("active", on);
      hdEl.classList.toggle("picking", on);
      pickBtn.classList.toggle("active", on);
      pickBtn.setAttribute("aria-pressed", on ? "true" : "false");
      document.documentElement.style.cursor = on ? "crosshair" : "";
      if (!on) hideHighlight();
      renderCart();
    }
    function updateLayout() {
      const isDock = effectiveDock();
      panel.classList.toggle("docked", isDock);
      const intentDock = dockMode === "dock";
      floatBtn.classList.toggle("active", !intentDock);
      dockBtn.classList.toggle("active", intentDock);
      const reflow = isDock && isOpen();
      if (reflow) applyReflow(DOCK_WIDTH);
      else clearReflow();
      positionTab();
      tab.style.display = isDock && isOpen() ? "none" : "";
      positionToast();
      scheduleHlUpdate();
    }
    let htmlSnap = null;
    function applyReflow(w) {
      const de = document.documentElement;
      if (htmlSnap === null) {
        htmlSnap = { marginRight: de.style.marginRight, width: de.style.width };
      }
      de.style.marginRight = w + "px";
      de.style.width = `calc(100% - ${w}px)`;
      de.style.setProperty("--pinpoint-dock-width", w + "px");
    }
    function clearReflow() {
      const de = document.documentElement;
      if (htmlSnap) {
        de.style.marginRight = htmlSnap.marginRight;
        de.style.width = htmlSnap.width;
        htmlSnap = null;
      } else {
        de.style.marginRight = "";
        de.style.width = "";
      }
      de.style.removeProperty("--pinpoint-dock-width");
    }
    function setDock(mode) {
      dockMode = mode === "dock" ? "dock" : "float";
      saveDock();
      updateLayout();
    }
    function positionTab() {
      const vh = window.innerHeight;
      let topPx = fabPos.top * vh;
      const maxTop = Math.max(0, vh - TAB_H);
      if (topPx < 0) topPx = 0;
      if (topPx > maxTop) topPx = maxTop;
      tab.style.top = `${Math.round(topPx)}px`;
      tab.style.bottom = "auto";
      applyTabSide(fabPos.side);
    }
    function applyTabSide(side) {
      tab.classList.toggle("side-left", side === "left");
      tab.classList.toggle("side-right", side === "right");
      if (side === "right") {
        const shift = effectiveDock() && isOpen() ? DOCK_WIDTH : 0;
        tab.style.right = `${shift}px`;
        tab.style.left = "auto";
      } else {
        tab.style.left = "0px";
        tab.style.right = "auto";
      }
    }
    function onTabPointerDown(e) {
      if (e.button != null && e.button !== 0) return;
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        startTopPx: parseFloat(tab.style.top) || 0,
        pointerId: e.pointerId,
        moved: false
      };
      tab.classList.add("dragging");
      try {
        tab.setPointerCapture(e.pointerId);
      } catch {
      }
      window.addEventListener("pointermove", onTabPointerMove, true);
      window.addEventListener("pointerup", onTabPointerUp, true);
      e.preventDefault();
    }
    function onTabPointerMove(e) {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (!dragState.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      dragState.moved = true;
      const vh = window.innerHeight;
      const maxTop = Math.max(0, vh - TAB_H);
      let topPx = dragState.startTopPx + dy;
      topPx = Math.min(maxTop, Math.max(0, topPx));
      tab.style.top = `${Math.round(topPx)}px`;
      tab.style.bottom = "auto";
      const side = e.clientX < window.innerWidth / 2 ? "left" : "right";
      if (side !== fabPos.side) {
        fabPos.side = side;
        applyTabSide(side);
      }
    }
    function onTabPointerUp() {
      window.removeEventListener("pointermove", onTabPointerMove, true);
      window.removeEventListener("pointerup", onTabPointerUp, true);
      tab.classList.remove("dragging");
      const st = dragState;
      dragState = null;
      if (!st) return;
      try {
        tab.releasePointerCapture(st.pointerId);
      } catch {
      }
      if (st.moved) {
        const vh = window.innerHeight;
        const topPx = parseFloat(tab.style.top) || 0;
        fabPos.top = vh > 0 ? topPx / vh : 0.6;
        saveFabPos();
      } else {
        togglePanel();
      }
    }
    function hideHighlight() {
      highlight.style.display = "none";
    }
    function isOurs(node) {
      return node === host || node && node.nodeType === 1 && host.contains(node);
    }
    function onMouseMove(e) {
      if (!picking) return;
      const topEl = document.elementFromPoint(e.clientX, e.clientY);
      if (isOurs(topEl)) {
        hideHighlight();
        return;
      }
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
      hlChip.textContent = shortLabel(el);
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
      const selector2 = safeSelector(el);
      if (cart.some((c) => c.selector === selector2)) {
        toast("Already picked", "warn");
        return;
      }
      const item = {
        uid: ++uidSeq,
        selector: selector2,
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
        thumb: null,
        capturing: true
      };
      cart.push(item);
      renderCart();
      if (cart.length > SOFT_LIMIT) {
        toast(`Many elements (${cart.length}) \u2014 consider splitting into tasks`, "warn");
      }
      captureScreenshot(el).then(async (shot) => {
        const live = cart.find((c) => c.uid === item.uid);
        if (!live) return;
        live.screenshot = shot || null;
        live.capturing = false;
        renderCart();
        if (!shot) return;
        const thumb = await makeThumb(shot);
        const live2 = cart.find((c) => c.uid === item.uid);
        if (!live2) return;
        live2.thumb = thumb || null;
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
      cartPillEl.textContent = String(n);
      sendBtn.textContent = n === 0 ? "Send task (0) \u2192" : `Send task (${n}) \u2192`;
      sendBtn.disabled = sending || n === 0 || !online;
      pickHelpEl.style.display = n === 0 ? "block" : "none";
      composeQueuedEl.style.display = !online && n > 0 ? "block" : "none";
      if (n === 0) {
        cartListEl.innerHTML = `
        <div class="cart-empty">
          <div class="ce-glyph">\uFF0B</div>
          <p class="ce-title">Nothing picked yet</p>
          <p class="ce-sub">${picking ? "Hover + click elements on the page." : "Pick an element to start a task."}</p>
        </div>`;
        renderCartHighlights();
        return;
      }
      cartListEl.innerHTML = cart.map((c, i) => {
        const thumbInner = c.thumb ? `<img class="ci-thumb" src="${escapeHtml(c.thumb)}" alt="" />` : `<div class="ci-thumb placeholder">${c.capturing ? "\u2026" : "\u25A2"}</div>`;
        return `
          <div class="cart-item" data-uid="${c.uid}">
            <span class="ci-idx">${i + 1}</span>
            <span class="ci-thumb-wrap">${thumbInner}</span>
            <span class="ci-sel" title="${escapeHtml(c.selector)}">${escapeHtml(c.selector)}</span>
            <button class="ci-rm" data-uid="${c.uid}" title="Remove" aria-label="Remove">\u2715</button>
          </div>`;
      }).join("");
      renderCartHighlights();
    }
    let hlRaf = null;
    function renderCartHighlights() {
      cartHlEl.innerHTML = cart.map((c, i) => `<div class="cart-hl" data-uid="${c.uid}"><span class="num">${i + 1}</span></div>`).join("");
      positionCartHighlights();
    }
    function positionCartHighlights() {
      const show = isOpen();
      const boxes = cartHlEl.children;
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        const uid = Number(box.getAttribute("data-uid"));
        const item = cart.find((c) => c.uid === uid);
        let rect = null;
        if (show && item) {
          try {
            const el = document.querySelector(item.selector);
            if (el && !isOurs(el)) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 || r.height > 0) rect = r;
            }
          } catch {
          }
        }
        if (!rect) {
          box.style.display = "none";
          continue;
        }
        box.style.display = "block";
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
      }
    }
    function scheduleHlUpdate() {
      if (hlRaf) return;
      hlRaf = requestAnimationFrame(() => {
        hlRaf = null;
        positionCartHighlights();
      });
    }
    function clearCartHighlights() {
      cartHlEl.innerHTML = "";
    }
    function emphasizeCartBox(uid, on) {
      const box = cartHlEl.querySelector(`.cart-hl[data-uid="${uid}"]`);
      if (box) box.classList.toggle("emph", on);
    }
    function effectiveBg(el) {
      const opaque = (c) => c && c !== "transparent" && !/,\s*0\)\s*$/.test(c);
      let node = el;
      while (node && node.nodeType === 1) {
        const bg = getComputedStyle(node).backgroundColor;
        if (opaque(bg)) return bg;
        node = node.parentElement;
      }
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      if (opaque(bodyBg)) return bodyBg;
      const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
      if (opaque(htmlBg)) return htmlBg;
      return "#ffffff";
    }
    async function captureScreenshot(el) {
      try {
        const shot = toJpeg(el, {
          quality: 0.92,
          // Near-native but capped at 2× so a 3×/HiDPI display can't blow the
          // bridge's 24 MB body cap.
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          // Fill transparent regions with the element's real (inherited) background
          // instead of JPEG's default black — matches the app, light or dark.
          backgroundColor: effectiveBg(el),
          // Don't fetch/inline @font-face web fonts (spams the host console with 404s).
          skipFonts: true,
          filter: (node) => !isOurs(node)
        });
        const guard = new Promise((resolve) => setTimeout(() => resolve(null), 4e3));
        return await Promise.race([shot, guard]);
      } catch {
        return null;
      }
    }
    function makeThumb(dataUrl) {
      return new Promise((resolve) => {
        if (!dataUrl) {
          resolve(null);
          return;
        }
        try {
          const img = new Image();
          img.onload = () => {
            try {
              const MAX = 240;
              const scale = Math.min(1, MAX / Math.max(img.width || 1, img.height || 1));
              const w = Math.max(1, Math.round((img.width || 1) * scale));
              const h = Math.max(1, Math.round((img.height || 1) * scale));
              const canvas = document.createElement("canvas");
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext("2d");
              if (!ctx) {
                resolve(null);
                return;
              }
              ctx.imageSmoothingEnabled = true;
              if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
              ctx.drawImage(img, 0, 0, w, h);
              resolve(canvas.toDataURL("image/jpeg", 0.8));
            } catch {
              resolve(null);
            }
          };
          img.onerror = () => resolve(null);
          img.src = dataUrl;
        } catch {
          resolve(null);
        }
      });
    }
    async function send() {
      if (sending) return;
      if (cart.length === 0) return;
      if (!online) {
        toast(`Bridge offline (${hostLabel})`, "err");
        return;
      }
      const taskText = textarea.value.trim();
      if (!taskText) {
        textarea.focus();
        toast("Enter a task first", "warn");
        return;
      }
      sending = true;
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending\u2026";
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
          setOnline(true);
          let taskId = "";
          try {
            const body = await res.json();
            taskId = body && body.task_id != null ? String(body.task_id) : "";
          } catch {
          }
          const MAX_STORED_THUMBS = 4;
          const thumbs = [];
          for (const c of cart) {
            if (thumbs.length >= MAX_STORED_THUMBS) break;
            const th = c.thumb || (c.screenshot ? await makeThumb(c.screenshot) : null);
            if (th) thumbs.push({ selector: c.selector, thumb: th });
          }
          tasks.unshift({
            id: taskId,
            note: taskText,
            count: items.length,
            status: "queued",
            ts: Date.now(),
            thumbs: thumbs.length ? thumbs : void 0
          });
          saveTasks();
          clearCart();
          textarea.value = "";
          setPicking(false);
          renderHistory();
          toast(`Task #${taskId || "?"} sent (${items.length})`);
        } else {
          toast(`Error: ${res.status}`, "err");
        }
      } catch {
        setOnline(false);
        toast(`Bridge offline (${hostLabel})`, "err");
      } finally {
        sending = false;
        renderCart();
      }
    }
    function taskKey(t) {
      return t && t.id ? String(t.id) : `ts:${t && t.ts ? t.ts : "0"}`;
    }
    function elementThumbs(t) {
      if (Array.isArray(t.thumbs) && t.thumbs.length) {
        return t.thumbs.filter((x) => x && x.thumb).map((x) => ({ thumb: x.thumb, selector: x.selector || "" }));
      }
      if (t.thumb) return [{ thumb: t.thumb, selector: "" }];
      return [];
    }
    function thumbImg(dataUrl, cls) {
      return dataUrl ? `<img class="${cls}" src="${escapeHtml(dataUrl)}" alt="" />` : `<div class="${cls} placeholder">\u25A2</div>`;
    }
    function renderHistory() {
      histCntEl.textContent = tasks.length ? tasks.length === 1 ? "1 task" : `${tasks.length} tasks` : "";
      if (!tasks.length) {
        histListEl.innerHTML = '<div class="hist-empty">No task history</div>';
        return;
      }
      histListEl.innerHTML = tasks.map((t) => {
        const status = normalizeStatus(t.status);
        const key = taskKey(t);
        const isExpanded = expandedRows.has(key);
        const idLabel = t.id ? `#${escapeHtml(String(t.id))}` : "";
        const note = t.note || "";
        const els = elementThumbs(t);
        const statusHtml = t.statusNote ? `<div class="hist-status st-${status}">${escapeHtml(t.statusNote)}</div>` : "";
        const elsHtml = els.length ? `<div class="hist-els">${els.map((e) => `
                <div class="hist-el">
                  ${thumbImg(e.thumb, "hist-el-img")}
                  ${e.selector ? `<span class="hist-el-sel" title="${escapeHtml(e.selector)}">${escapeHtml(e.selector)}</span>` : ""}
                </div>`).join("")}</div>` : "";
        const idAttr = escapeHtml(String(t.id || ""));
        return `
          <div class="hist-row" data-key="${escapeHtml(key)}" data-expanded="${isExpanded ? "1" : "0"}">
            <div class="hist-head">
              <span class="hist-dot dot-${status}"></span>
              <span class="hist-note-1">${idLabel ? `<span class="hist-id">${idLabel}</span> ` : ""}${escapeHtml(note)}</span>
              <span class="hist-time">${escapeHtml(relTime(t.ts))}</span>
              <span class="hist-chevron">\u25B8</span>
            </div>
            <div class="hist-detail"><div class="hist-detail-inner"><div class="hist-detail-pad">
              <p class="hist-note-full clamp">${escapeHtml(note)}</p>
              <span class="hist-note-more" data-act="note-more">Show more</span>
              ${statusHtml}
              ${elsHtml}
              <div class="hist-fu">
                <input type="text" placeholder="Follow up\u2026" data-id="${idAttr}" />
                <button class="btn-fu" data-id="${idAttr}" title="Send follow-up" aria-label="Send follow-up">\u2192</button>
              </div>
            </div></div></div>
          </div>`;
      }).join("");
      requestAnimationFrame(() => {
        histListEl.querySelectorAll('.hist-row[data-expanded="1"]').forEach(measureNote);
      });
    }
    function measureNote(row) {
      const note = row.querySelector(".hist-note-full");
      const more = row.querySelector(".hist-note-more");
      if (!note || !more) return;
      if (!note.classList.contains("clamp")) {
        more.style.display = "inline";
        return;
      }
      more.style.display = note.scrollHeight > note.clientHeight + 2 ? "inline" : "none";
    }
    function toggleRow(row) {
      const key = row.getAttribute("data-key");
      if (!key) return;
      const willOpen = !expandedRows.has(key);
      if (willOpen) expandedRows.add(key);
      else expandedRows.delete(key);
      row.setAttribute("data-expanded", willOpen ? "1" : "0");
      if (willOpen) requestAnimationFrame(() => measureNote(row));
    }
    function updateRowStatus(t) {
      const key = taskKey(t);
      const row = histListEl.querySelector(`.hist-row[data-key="${cssEscape(key)}"]`);
      if (!row) {
        renderHistory();
        return;
      }
      const status = normalizeStatus(t.status);
      const dot = row.querySelector(".hist-dot");
      if (dot) dot.className = `hist-dot dot-${status}`;
      if (t.statusNote) {
        let sn = row.querySelector(".hist-status");
        if (!sn) {
          const noteMore = row.querySelector(".hist-note-more");
          if (noteMore && noteMore.parentNode) {
            sn = document.createElement("div");
            noteMore.parentNode.insertBefore(sn, noteMore.nextSibling);
          }
        }
        if (sn) {
          sn.className = `hist-status st-${status}`;
          sn.textContent = t.statusNote;
        }
      }
    }
    function updateRelTimes() {
      const rows = histListEl.querySelectorAll(".hist-row");
      rows.forEach((row) => {
        const key = row.getAttribute("data-key");
        const t = tasks.find((x) => taskKey(x) === key);
        if (!t) return;
        const el = row.querySelector(".hist-time");
        if (el) el.textContent = relTime(t.ts);
      });
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
          setOnline(true);
          if (inputEl) inputEl.value = "";
          toast(`Follow-up on #${taskId} sent`);
        } else {
          toast(`Error: ${res.status}`, "err");
        }
      } catch {
        setOnline(false);
        toast(`Bridge offline (${hostLabel})`, "err");
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
      es.onopen = () => setOnline(true);
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
        updateRowStatus(t);
      };
      es.onerror = () => {
        checkHealth();
      };
    }
    async function checkHealth() {
      try {
        const res = await fetch(`${base}/health`, { cache: "no-store" });
        setOnline(!!res.ok);
      } catch {
        setOnline(false);
      }
    }
    function setOnline(ok) {
      if (ok) {
        const was = online;
        online = true;
        retryCount = 0;
        hdEl.classList.remove("offline");
        offlineBanner.style.display = "none";
        if (!was) renderCart();
      } else {
        online = false;
        retryCount++;
        hdEl.classList.add("offline");
        hdOfflineEl.style.display = "inline";
        offlineBanner.style.display = "block";
        obHostEl.textContent = `${hostLabel} \u2014 retrying\u2026 `;
        obRetryEl.textContent = `(${retryCount})`;
        renderCart();
      }
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
    function loadDock() {
      try {
        return localStorage.getItem(DOCK_KEY) === "dock" ? "dock" : "float";
      } catch {
        return "float";
      }
    }
    function saveDock() {
      try {
        localStorage.setItem(DOCK_KEY, dockMode);
      } catch {
      }
    }
    function loadFabPos() {
      try {
        const o = JSON.parse(localStorage.getItem(FAB_KEY) || "null");
        const side = o && (o.side === "left" || o.side === "right") ? o.side : "right";
        let top = o && typeof o.top === "number" ? o.top : 0.6;
        if (!(top >= 0 && top <= 1)) top = 0.6;
        return { side, top };
      } catch {
        return { side: "right", top: 0.6 };
      }
    }
    function saveFabPos() {
      try {
        localStorage.setItem(FAB_KEY, JSON.stringify(fabPos));
      } catch {
      }
    }
    function relTime(ts) {
      if (!ts) return "";
      const s = Math.max(0, Math.floor((Date.now() - ts) / 1e3));
      if (s < 45) return "now";
      const m = Math.floor(s / 60);
      if (m < 60) return `${Math.max(1, m)}m`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h`;
      const d = Math.floor(h / 24);
      return `${d}d`;
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
    function shortLabel(el) {
      if (!el || !el.tagName) return "";
      let s = el.tagName.toLowerCase();
      if (el.id) return `${s}#${el.id}`;
      if (el.classList && el.classList.length) {
        const cls = Array.prototype.find.call(el.classList, (c) => /^[a-zA-Z][\w-]*$/.test(c));
        if (cls) s += `.${cls}`;
      }
      return s;
    }
    function escapeHtml(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    let toastTimer = null;
    function toast(msg, kind) {
      toastMsgEl.textContent = msg;
      toastDotEl.style.background = kind === "err" ? TOAST_ERR : kind === "warn" ? TOAST_WARN : TOAST_OK;
      toastEl.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
    }
    function positionToast() {
      const shifted = effectiveDock() && isOpen();
      toastEl.style.right = shifted ? `${DOCK_WIDTH + 20}px` : "";
    }
    tab.addEventListener("pointerdown", onTabPointerDown);
    closeBtn.addEventListener("click", closePanel);
    pickBtn.addEventListener("click", () => setPicking(!picking));
    escChip.addEventListener("click", () => setPicking(false));
    floatBtn.addEventListener("click", () => setDock("float"));
    dockBtn.addEventListener("click", () => setDock("dock"));
    sendBtn.addEventListener("click", send);
    cartListEl.addEventListener("click", (e) => {
      const rm = e.target.closest(".ci-rm");
      if (!rm) return;
      const uid = Number(rm.getAttribute("data-uid"));
      if (uid) removeFromCart(uid);
    });
    cartListEl.addEventListener("mouseover", (e) => {
      const item = e.target.closest(".cart-item");
      if (!item) return;
      const uid = Number(item.getAttribute("data-uid"));
      if (uid) emphasizeCartBox(uid, true);
    });
    cartListEl.addEventListener("mouseout", (e) => {
      const item = e.target.closest(".cart-item");
      if (!item) return;
      if (e.relatedTarget && item.contains(e.relatedTarget)) return;
      const uid = Number(item.getAttribute("data-uid"));
      if (uid) emphasizeCartBox(uid, false);
    });
    histListEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-fu");
      if (btn) {
        const row2 = btn.closest(".hist-row");
        const input = row2 ? row2.querySelector(".hist-fu input") : null;
        sendFollowup(btn.getAttribute("data-id"), input ? input.value : "", input);
        return;
      }
      const more = e.target.closest(".hist-note-more");
      if (more) {
        const note = more.closest(".hist-detail-pad")?.querySelector(".hist-note-full");
        if (note) {
          const clamped = note.classList.toggle("clamp");
          more.textContent = clamped ? "Show more" : "Show less";
        }
        return;
      }
      if (e.target.closest(".hist-fu")) return;
      const head = e.target.closest(".hist-head");
      if (!head) return;
      const row = head.closest(".hist-row");
      if (row) toggleRow(row);
    });
    histListEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const input = e.target.closest(".hist-fu input");
      if (!input) return;
      e.preventDefault();
      sendFollowup(input.getAttribute("data-id"), input.value, input);
    });
    textarea.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey || e.shiftKey) && e.key === "Enter") {
        e.preventDefault();
        send();
      } else if (e.key === "Escape") {
        closePanel();
      }
    });
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("click", onClickCapture, true);
    window.addEventListener("scroll", () => {
      hideHighlight();
      scheduleHlUpdate();
    }, true);
    window.addEventListener("resize", () => {
      updateLayout();
      scheduleHlUpdate();
    });
    window.addEventListener("pagehide", clearReflow);
    window.addEventListener("pageshow", () => {
      updateLayout();
      positionTab();
    });
    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        togglePanel();
        return;
      }
      if (e.key === "Escape" && picking) {
        e.preventDefault();
        setPicking(false);
      }
    }, true);
    function cssEscape(v) {
      const s = String(v);
      if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(s);
      return s.replace(/["\\\]]/g, "\\$&");
    }
    updateLayout();
    connectStatus();
    checkHealth();
    setInterval(checkHealth, 5e3);
    setInterval(() => {
      if (isOpen()) updateRelTimes();
    }, 6e4);
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
