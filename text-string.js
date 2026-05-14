import {
    layoutNextLineRange,
    materializeLineRange,
    prepareWithSegments,
} from "./vendor/pretext/dist/layout.js";

const config = {
    tailLetters: 9,
    bottomCueOffset: 72,
    tailDropImpulse: 5.5,
    constraintScale: 1.14,
    unlockThreshold: 2,
    iterations: 9,
    damping: 0.965,
    gravity: 0.18,
    fixedDt: 1 / 120,
    maxSteps: 4,
    affordanceDelay: 1000,
    browserLayoutBreakpoint: 980,
};

const supportsSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

if (supportsSegmenter && !prefersReducedMotion.matches) {
    const boot = async () => {
        await waitForRizomaFonts();

        const container = document.querySelector(".text_container");
        if (container) new TextString(container).mount();
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
}

class TextString {
    constructor(container) {
        this.container = container;
        this.sources = Array.from(container.children).filter(
            (child) => child.matches("p") && !child.classList.contains("signature"),
        );
        this.segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
        this.measureContext = document.createElement("canvas").getContext("2d");
        this.overlay = document.createElement("div");
        this.overlay.className = "text-string-layer";
        this.overlay.setAttribute("aria-hidden", "true");
        this.affordance = this.createAffordance();

        this.letters = [];
        this.elements = [];
        this.tailIndices = [];
        this.restLengths = [];
        this.drags = new Map();
        this.frameId = 0;
        this.lastTime = -1;
        this.accumulator = 0;
        this.started = false;
        this.userInteracted = false;
        this.tailCueDropped = false;
        this.scrollTicking = false;
        this.affordanceVisible = false;
        this.affordancePlaced = false;
        this.affordanceTimer = 0;
        this.resizeTimer = 0;

        this.onPointerDown = this.onPointerDown.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
        this.onResize = this.onResize.bind(this);
        this.onScroll = this.onScroll.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.render = this.render.bind(this);
    }

    mount() {
        if (!this.sources.length) return;

        this.installLinkHover();
        this.container.appendChild(this.overlay);
        this.sources.forEach((source) => source.classList.add("text-string-source"));
        this.rebuild();

        if (!this.letters.length) {
            this.overlay.remove();
            this.sources.forEach((source) => source.classList.remove("text-string-source"));
            return;
        }

        this.container.classList.add("text-string-ready");
        this.overlay.addEventListener("pointerdown", this.onPointerDown);
        window.addEventListener("pointermove", this.onPointerMove, { passive: false });
        window.addEventListener("pointerup", this.onPointerUp);
        window.addEventListener("pointercancel", this.onPointerUp);
        window.addEventListener("resize", this.onResize);
        window.addEventListener("scroll", this.onScroll, { passive: true });
        window.addEventListener("keydown", this.onKeyDown);
        this.checkScrollAffordance();
    }

    installLinkHover() {
        this.sources.forEach((source, sourceIndex) => {
            source.querySelectorAll("a").forEach((anchor, linkIndex) => {
                const linkId = `${sourceIndex}-${linkIndex}`;
                anchor.dataset.textStringLink = linkId;

                const setActive = (active) => {
                    this.overlay
                        .querySelectorAll(`[data-link-id="${linkId}"]`)
                        .forEach((letter) => letter.classList.toggle("is-link-active", active));
                };

                anchor.addEventListener("mouseenter", () => setActive(true));
                anchor.addEventListener("mouseleave", () => setActive(false));
                anchor.addEventListener("focus", () => setActive(true));
                anchor.addEventListener("blur", () => setActive(false));
            });
        });
    }

    rebuild() {
        this.drags.clear();
        this.started = false;
        this.tailCueDropped = false;
        this.hideAffordance();
        this.lastTime = -1;
        this.accumulator = 0;
        this.overlay.replaceChildren();
        this.letters = this.buildLetters();
        this.elements = this.letters.map((letter, index) => this.createLetterElement(letter, index));
        this.elements.forEach((element) => this.overlay.appendChild(element));
        this.overlay.appendChild(this.affordance);
        this.overlay.style.height = `${this.container.scrollHeight}px`;
        this.restLengths = this.computeRestLengths();
        this.armTail();
        this.paint();
    }

    buildLetters() {
        if (usesBrowserLayout()) {
            const browserLetters = this.buildBrowserLetters();
            if (browserLetters.length) return browserLetters;
        }

        return this.buildPretextLetters();
    }

    buildPretextLetters() {
        const containerRect = this.container.getBoundingClientRect();
        const visualLines = [];

        for (const source of this.sources) {
            const sourceRect = source.getBoundingClientRect();
            const sourceStyle = window.getComputedStyle(source);
            const sourceGraphemes = collectStyledGraphemes(source, this.segmenter);
            const text = sourceGraphemes.map((item) => item.ch).join("");
            if (!text) continue;

            const baseFont = canvasFont(sourceStyle);
            const prepared = prepareWithSegments(text, baseFont);
            const lineHeight = px(sourceStyle.lineHeight, px(sourceStyle.fontSize, 24) * 1.4);
            const textIndent = px(sourceStyle.textIndent, 0);
            const paragraphX = sourceRect.left - containerRect.left;
            const paragraphY = sourceRect.top - containerRect.top;
            const paragraphWidth = source.clientWidth || sourceRect.width;

            let cursor = { segmentIndex: 0, graphemeIndex: 0 };
            let lineIndex = 0;
            let sourceIndex = 0;

            while (true) {
                const indent = lineIndex === 0 ? textIndent : 0;
                const maxWidth = Math.max(20, paragraphWidth - indent);
                const range = layoutNextLineRange(prepared, cursor, maxWidth);
                if (range === null) break;

                const line = materializeLineRange(prepared, range);
                const lineGraphemes = graphemes(line.text, this.segmenter);
                const lineLetters = [];
                let x = paragraphX + indent;
                const y = paragraphY + lineIndex * lineHeight;

                for (const ch of lineGraphemes) {
                    const next = takeSourceGrapheme(sourceGraphemes, sourceIndex, ch);
                    sourceIndex = next.index + 1;
                    const styled = next.item;
                    const font = canvasFont(sourceStyle, styled);
                    const width = measureGrapheme(this.measureContext, ch, font);

                    lineLetters.push({
                        ch,
                        display: ch === " " ? "\u00a0" : ch,
                        x,
                        y,
                        ox: x,
                        oy: y,
                        px: x,
                        py: y,
                        w: width,
                        h: lineHeight,
                        fontStyle: styled.fontStyle,
                        fontVariant: styled.fontVariant,
                        linkId: styled.linkId,
                        locked: true,
                    });

                    x += width;
                }

                if (lineLetters.length) visualLines.push(lineLetters);
                cursor = range.end;
                lineIndex += 1;
            }
        }

        const ordered = [];
        const lastLineIndex = visualLines.length - 1;
        const flipEvenLines = lastLineIndex % 2 === 1;

        visualLines.forEach((line, lineIndex) => {
            const reversed = flipEvenLines ? lineIndex % 2 === 0 : lineIndex % 2 === 1;
            ordered.push(...(reversed ? [...line].reverse() : line));
        });

        return ordered;
    }

    buildBrowserLetters() {
        const containerRect = this.container.getBoundingClientRect();
        const letters = [];

        for (const source of this.sources) {
            const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
            let pendingSpace = null;
            let sourceHasLetters = false;
            let node = walker.nextNode();

            while (node) {
                const parent = node.parentElement || source;
                const style = window.getComputedStyle(parent);
                const linkId = parent.closest("a")?.dataset.textStringLink || "";

                for (const part of this.segmenter.segment(node.nodeValue || "")) {
                    const ch = part.segment;
                    const start = part.index;
                    const end = start + ch.length;

                    if (isCollapsibleSpace(ch)) {
                        if (sourceHasLetters) pendingSpace = { node, start, end, style, linkId };
                        continue;
                    }

                    if (pendingSpace) {
                        const letter = this.createBrowserLetter(pendingSpace, " ", containerRect);
                        if (letter) {
                            letters.push(letter);
                            sourceHasLetters = true;
                        }
                        pendingSpace = null;
                    }

                    const letter = this.createBrowserLetter({ node, start, end, style, linkId }, ch, containerRect);
                    if (letter) {
                        letters.push(letter);
                        sourceHasLetters = true;
                    }
                }

                node = walker.nextNode();
            }
        }

        return orderVisualLines(letters);
    }

    createBrowserLetter(source, ch, containerRect) {
        const range = document.createRange();
        range.setStart(source.node, source.start);
        range.setEnd(source.node, source.end);
        const rect = visibleRangeRect(range);
        range.detach();

        if (rect === null) return null;

        const font = canvasFont(source.style, source);
        const measuredWidth = measureGrapheme(this.measureContext, ch, font);
        const lineHeight = px(source.style.lineHeight, px(source.style.fontSize, 24) * 1.4);
        const x = rect.left - containerRect.left;
        const y = rect.top - containerRect.top;
        const width = Math.max(rect.width, measuredWidth, ch === " " ? measuredWidth : 1);

        return {
            ch,
            display: ch === " " ? "\u00a0" : ch,
            x,
            y,
            ox: x,
            oy: y,
            px: x,
            py: y,
            w: width,
            h: lineHeight,
            fontStyle: source.style.fontStyle,
            fontVariant: source.style.fontVariant,
            linkId: source.linkId,
            locked: true,
        };
    }

    createLetterElement(letter, index) {
        const element = document.createElement("span");
        element.className = "text-string-letter";
        element.textContent = letter.display;
        element.dataset.index = `${index}`;

        if (letter.linkId) {
            element.dataset.linkId = letter.linkId;
            element.classList.add("is-link");
        }

        if (letter.fontStyle && letter.fontStyle !== "normal") {
            element.style.fontStyle = letter.fontStyle;
        }

        if (letter.fontVariant && letter.fontVariant.includes("small-caps")) {
            element.style.fontVariant = "small-caps";
        }

        element.style.width = `${Math.max(letter.w, 1)}px`;
        element.style.height = `${letter.h}px`;
        element.style.lineHeight = `${letter.h}px`;
        element.style.transform = `translate(${letter.x}px, ${letter.y}px)`;
        return element;
    }

    createAffordance() {
        const affordance = document.createElement("div");
        affordance.className = "text-string-affordance";
        affordance.innerHTML = `
            <svg class="text-string-affordance-arrow" viewBox="0 0 164 84" focusable="false">
                <path d="M50 72 C58 50 92 25 145 15" />
                <path d="M126 10 L145 15 L132 29" />
            </svg>
            <span>Drag me</span>
        `;
        return affordance;
    }

    computeRestLengths() {
        const restLengths = [];

        for (let index = 0; index < this.letters.length - 1; index += 1) {
            const a = this.letters[index];
            const b = this.letters[index + 1];
            const dx = centerX(b) - centerX(a);
            const dy = centerY(b) - centerY(a);
            restLengths.push(Math.hypot(dx, dy) * config.constraintScale);
        }

        return restLengths;
    }

    armTail() {
        let armed = 0;
        this.tailIndices = [];

        for (let index = this.letters.length - 1; index >= 0; index -= 1) {
            const letter = this.letters[index];
            if (armed >= config.tailLetters) break;
            letter.locked = false;
            this.tailIndices.push(index);
            this.elements[index]?.classList.add("is-draggable");
            if (letter.ch.trim()) armed += 1;
        }
    }

    onPointerDown(event) {
        const target = event.target.closest(".text-string-letter");
        if (!target || !target.classList.contains("is-draggable")) return;

        const index = Number(target.dataset.index);
        if (!Number.isFinite(index) || this.letters[index]?.locked || this.isDragged(index)) return;

        const rect = this.container.getBoundingClientRect();
        const letter = this.letters[index];
        this.userInteracted = true;
        this.started = true;
        this.hideAffordance();
        this.drags.set(event.pointerId, {
            index,
            offsetX: event.clientX - rect.left - letter.x,
            offsetY: event.clientY - rect.top - letter.y,
        });

        target.classList.add("is-dragging");
        target.setPointerCapture(event.pointerId);
        this.ensureLoop();
        event.preventDefault();
    }

    onPointerMove(event) {
        const drag = this.drags.get(event.pointerId);
        if (!drag) return;

        const rect = this.container.getBoundingClientRect();
        const letter = this.letters[drag.index];
        const bounds = this.getViewportBounds(rect, letter);
        letter.x = clamp(event.clientX - rect.left - drag.offsetX, bounds.minX, bounds.maxX);
        letter.y = clamp(event.clientY - rect.top - drag.offsetY, bounds.minY, bounds.maxY);
        letter.px = letter.x;
        letter.py = letter.y;
        letter.locked = false;
        event.preventDefault();
    }

    onPointerUp(event) {
        const drag = this.drags.get(event.pointerId);
        if (!drag) return;

        this.elements[drag.index]?.classList.remove("is-dragging");
        this.drags.delete(event.pointerId);
    }

    onResize() {
        window.clearTimeout(this.resizeTimer);
        this.resizeTimer = window.setTimeout(() => {
            this.rebuild();
            this.checkScrollAffordance();
        }, 160);
    }

    onScroll() {
        if (this.scrollTicking) return;

        this.scrollTicking = true;
        requestAnimationFrame(() => {
            this.scrollTicking = false;
            this.checkScrollAffordance();
        });
    }

    onKeyDown(event) {
        if (event.key === "Escape") this.reset();
    }

    reset() {
        this.drags.clear();
        this.started = false;
        this.userInteracted = false;
        this.tailCueDropped = false;
        this.affordancePlaced = false;
        this.hideAffordance();

        for (let index = 0; index < this.letters.length; index += 1) {
            const letter = this.letters[index];
            letter.x = letter.ox;
            letter.y = letter.oy;
            letter.px = letter.ox;
            letter.py = letter.oy;
            letter.locked = true;
            this.elements[index].classList.remove("is-draggable", "is-dragging");
        }

        this.armTail();
        this.paint();
    }

    checkScrollAffordance() {
        if (this.tailCueDropped || this.userInteracted || !this.tailIndices.length) return;
        if (pageScrollRemaining() > config.bottomCueOffset) return;
        this.dropTailCue();
    }

    dropTailCue() {
        this.tailCueDropped = true;
        this.started = true;

        this.tailIndices.forEach((index, position) => {
            const letter = this.letters[index];
            const drift = position % 2 === 0 ? 0.7 : -0.7;
            letter.locked = false;
            letter.px = letter.x - drift;
            letter.py = letter.y - config.tailDropImpulse - position * 0.45;
            this.elements[index]?.classList.add("is-draggable");
        });

        this.ensureLoop();
        this.scheduleAffordance();
    }

    ensureLoop() {
        if (!this.frameId) this.frameId = requestAnimationFrame(this.render);
    }

    render(now) {
        if (this.lastTime < 0) {
            this.lastTime = now;
            this.frameId = requestAnimationFrame(this.render);
            return;
        }

        const dt = Math.min((now - this.lastTime) / 1000, config.maxSteps * config.fixedDt);
        this.lastTime = now;
        this.accumulator += dt;

        while (this.accumulator >= config.fixedDt) {
            this.simulate();
            this.accumulator -= config.fixedDt;
        }

        this.paint();
        this.frameId = requestAnimationFrame(this.render);
    }

    simulate() {
        this.unlockPulledLetters();
        this.integrate();
        this.solveConstraints();
        this.solveCollisions();
        this.keepInViewport();
    }

    unlockPulledLetters() {
        if (!this.userInteracted) return;

        for (let index = this.letters.length - 2; index >= 0; index -= 1) {
            const current = this.letters[index];
            const next = this.letters[index + 1];
            if (!current.locked || next.locked) continue;

            const distance = Math.hypot(centerX(next) - originCenterX(current), centerY(next) - originCenterY(current));
            if (distance > this.restLengths[index] + config.unlockThreshold) {
                current.locked = false;
                current.px = current.x;
                current.py = current.y;
                this.elements[index].classList.add("is-draggable");
            }
        }
    }

    integrate() {
        for (let index = 0; index < this.letters.length; index += 1) {
            const letter = this.letters[index];
            if (letter.locked || this.isDragged(index)) continue;

            const vx = (letter.x - letter.px) * config.damping;
            const vy = (letter.y - letter.py) * config.damping;
            letter.px = letter.x;
            letter.py = letter.y;
            letter.x += vx;
            letter.y += vy + (this.started ? config.gravity : 0);
        }
    }

    solveConstraints() {
        for (let iteration = 0; iteration < config.iterations; iteration += 1) {
            for (let index = 0; index < this.letters.length - 1; index += 1) {
                const a = this.letters[index];
                const b = this.letters[index + 1];
                if (a.locked && b.locked) continue;

                const dx = centerX(b) - centerX(a);
                const dy = centerY(b) - centerY(a);
                const distance = Math.hypot(dx, dy) || 0.001;
                const difference = (distance - this.restLengths[index]) / distance;
                const aFixed = a.locked || this.isDragged(index);
                const bFixed = b.locked || this.isDragged(index + 1);

                if (aFixed && !bFixed) {
                    b.x -= dx * difference;
                    b.y -= dy * difference;
                } else if (!aFixed && bFixed) {
                    a.x += dx * difference;
                    a.y += dy * difference;
                } else if (!aFixed && !bFixed) {
                    a.x += dx * difference * 0.5;
                    a.y += dy * difference * 0.5;
                    b.x -= dx * difference * 0.5;
                    b.y -= dy * difference * 0.5;
                }
            }
        }
    }

    solveCollisions() {
        const radius = 7;
        const cellSize = radius * 2.4;
        const buckets = new Map();

        for (let index = 0; index < this.letters.length; index += 1) {
            if (this.letters[index].locked) continue;
            const letter = this.letters[index];
            const key = gridKey(centerX(letter), centerY(letter), cellSize);
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(index);
        }

        for (let index = 0; index < this.letters.length; index += 1) {
            const a = this.letters[index];
            if (a.locked) continue;

            const cellX = Math.floor(centerX(a) / cellSize);
            const cellY = Math.floor(centerY(a) / cellSize);

            for (let x = cellX - 1; x <= cellX + 1; x += 1) {
                for (let y = cellY - 1; y <= cellY + 1; y += 1) {
                    const bucket = buckets.get(`${x}:${y}`);
                    if (!bucket) continue;

                    for (const otherIndex of bucket) {
                        if (otherIndex <= index || Math.abs(otherIndex - index) <= 1) continue;
                        this.resolveCollision(index, otherIndex, radius);
                    }
                }
            }
        }
    }

    resolveCollision(aIndex, bIndex, radius) {
        const a = this.letters[aIndex];
        const b = this.letters[bIndex];
        const dx = centerX(b) - centerX(a);
        const dy = centerY(b) - centerY(a);
        const distance = Math.hypot(dx, dy) || 0.001;
        const minDistance = radius * 2;
        if (distance >= minDistance) return;

        const overlap = ((minDistance - distance) / distance) * 0.5;
        const aDragged = this.isDragged(aIndex);
        const bDragged = this.isDragged(bIndex);

        if (aDragged) {
            b.x += dx * overlap * 2;
            b.y += dy * overlap * 2;
        } else if (bDragged) {
            a.x -= dx * overlap * 2;
            a.y -= dy * overlap * 2;
        } else {
            a.x -= dx * overlap;
            a.y -= dy * overlap;
            b.x += dx * overlap;
            b.y += dy * overlap;
        }
    }

    keepInViewport() {
        const rect = this.container.getBoundingClientRect();
        const bounce = 0.4;

        for (let index = 0; index < this.letters.length; index += 1) {
            const letter = this.letters[index];
            if (letter.locked || this.isDragged(index)) continue;
            const bounds = this.getViewportBounds(rect, letter);

            if (letter.x < bounds.minX) {
                letter.x = bounds.minX;
                letter.px = letter.x + (letter.x - letter.px) * bounce;
            }

            if (letter.x > bounds.maxX) {
                letter.x = bounds.maxX;
                letter.px = letter.x + (letter.x - letter.px) * bounce;
            }

            if (letter.y < bounds.minY) {
                letter.y = bounds.minY;
                letter.py = letter.y + (letter.y - letter.py) * bounce;
            }

            if (letter.y > bounds.maxY) {
                letter.y = bounds.maxY;
                letter.py = letter.y + (letter.y - letter.py) * bounce;
            }
        }
    }

    getViewportBounds(containerRect, letter) {
        const gutter = 1;
        return {
            minX: -containerRect.left + gutter,
            minY: -containerRect.top + gutter,
            maxX: viewportWidth() - containerRect.left - letter.w - gutter,
            maxY: viewportHeight() - containerRect.top - letter.h - gutter,
        };
    }

    paint() {
        for (let index = 0; index < this.letters.length; index += 1) {
            const letter = this.letters[index];
            this.elements[index].style.transform = `translate(${letter.x}px, ${letter.y}px)`;
        }
    }

    showAffordance() {
        this.affordanceVisible = true;
        this.affordance.classList.add("is-visible");
        this.positionAffordance(true);
    }

    scheduleAffordance() {
        window.clearTimeout(this.affordanceTimer);
        this.affordanceTimer = window.setTimeout(() => {
            this.affordanceTimer = 0;
            if (!this.tailCueDropped || this.userInteracted) return;
            this.showAffordance();
        }, config.affordanceDelay);
    }

    hideAffordance() {
        window.clearTimeout(this.affordanceTimer);
        this.affordanceTimer = 0;
        this.affordanceVisible = false;
        this.affordancePlaced = false;
        this.affordance.classList.remove("is-visible");
    }

    positionAffordance(force = false) {
        if (!this.affordanceVisible || !this.tailIndices.length) return;
        if (this.affordancePlaced && !force) return;

        const rect = this.container.getBoundingClientRect();
        const tail = this.tailBounds();
        if (tail === null) return;

        const affordanceRect = this.affordance.getBoundingClientRect();
        const affordanceWidth = affordanceRect.width || 132;
        const affordanceHeight = affordanceRect.height || 92;
        const targetX = tail.left + tail.width * 0.5;
        const targetY = tail.top + tail.height * 0.2;
        const minX = -rect.left + 12;
        const maxX = viewportWidth() - rect.left - affordanceWidth - 12;
        const minY = -rect.top + 12;
        const maxY = viewportHeight() - rect.top - affordanceHeight - 12;
        const isMobile = usesBrowserLayout();
        const x = isMobile ? clamp(tail.left - 116, minX, maxX) : clamp(targetX - 154, minX, maxX);
        const y = isMobile ? clamp(tail.bottom - 24, minY, maxY) : clamp(targetY + 28, minY, maxY);

        this.affordance.style.transform = `translate(${x}px, ${y}px)`;
        this.affordancePlaced = true;
    }

    tailBounds() {
        let left = Number.POSITIVE_INFINITY;
        let top = Number.POSITIVE_INFINITY;
        let right = Number.NEGATIVE_INFINITY;
        let bottom = Number.NEGATIVE_INFINITY;

        for (const index of this.tailIndices) {
            const letter = this.letters[index];
            if (!letter) continue;
            left = Math.min(left, letter.x);
            top = Math.min(top, letter.y);
            right = Math.max(right, letter.x + letter.w);
            bottom = Math.max(bottom, letter.y + letter.h);
        }

        if (!Number.isFinite(left)) return null;
        return { left, top, right, bottom, width: right - left, height: bottom - top };
    }

    isDragged(index) {
        for (const drag of this.drags.values()) {
            if (drag.index === index) return true;
        }

        return false;
    }
}

async function waitForRizomaFonts() {
    try {
        if (!document.fonts?.load) return;

        await Promise.all([
            document.fonts.load('300 1rem "RizomaS-light"'),
            document.fonts.load('italic 300 1rem "RizomaS-light"'),
        ]);
        await document.fonts.ready;
        await nextFrame();
        await nextFrame();
    } catch {
        // The effect is decorative; keep the page normal if font loading is unavailable.
    }
}

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}

function usesBrowserLayout() {
    return viewportWidth() <= config.browserLayoutBreakpoint;
}

function visibleRangeRect(range) {
    for (const rect of range.getClientRects()) {
        if (rect.width > 0.01 && rect.height > 0.01) return rect;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width > 0.01 && rect.height > 0.01) return rect;
    return null;
}

function orderVisualLines(letters) {
    const lines = [];
    const orderedLetters = [...letters].sort((a, b) => a.y - b.y || a.x - b.x);

    for (const letter of orderedLetters) {
        const threshold = Math.max(4, letter.h * 0.5);
        let line = lines.find((item) => Math.abs(item.y - letter.y) <= threshold);

        if (!line) {
            line = { y: letter.y, h: letter.h, letters: [] };
            lines.push(line);
        }

        line.y = Math.min(line.y, letter.y);
        line.h = Math.max(line.h, letter.h);
        line.letters.push(letter);
    }

    lines.sort((a, b) => a.y - b.y);
    lines.forEach((line) => {
        line.letters.sort((a, b) => a.x - b.x);
        line.letters.forEach((letter) => {
            letter.y = line.y;
            letter.oy = line.y;
            letter.py = line.y;
            letter.h = line.h;
        });
    });

    const ordered = [];
    const lastLineIndex = lines.length - 1;
    const flipEvenLines = lastLineIndex % 2 === 1;

    lines.forEach((line, lineIndex) => {
        const reversed = flipEvenLines ? lineIndex % 2 === 0 : lineIndex % 2 === 1;
        ordered.push(...(reversed ? [...line.letters].reverse() : line.letters));
    });

    return ordered;
}

function collectStyledGraphemes(root, segmenter) {
    const graphemes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let pendingSpace = false;
    let node = walker.nextNode();

    while (node) {
        const parent = node.parentElement || root;
        const style = window.getComputedStyle(parent);
        const linkId = parent.closest("a")?.dataset.textStringLink || "";

        for (const ch of segmenter.segment(node.nodeValue)) {
            if (isCollapsibleSpace(ch.segment)) {
                if (graphemes.length) pendingSpace = true;
                continue;
            }

            if (pendingSpace) {
                graphemes.push(styledGrapheme(" ", style, linkId));
                pendingSpace = false;
            }

            graphemes.push(styledGrapheme(ch.segment, style, linkId));
        }

        node = walker.nextNode();
    }

    return graphemes;
}

function styledGrapheme(ch, style, linkId) {
    return {
        ch,
        fontStyle: style.fontStyle,
        fontVariant: style.fontVariant,
        fontWeight: style.fontWeight,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        linkId,
    };
}

function takeSourceGrapheme(source, startIndex, ch) {
    let index = Math.min(startIndex, source.length - 1);

    if (!sameGrapheme(source[index]?.ch, ch)) {
        const limit = Math.min(source.length, index + 8);
        for (let scan = index + 1; scan < limit; scan += 1) {
            if (sameGrapheme(source[scan].ch, ch)) {
                index = scan;
                break;
            }
        }
    }

    const fallback = source[index] || {
        ch,
        fontStyle: "normal",
        fontVariant: "normal",
        fontWeight: "300",
        fontSize: "24px",
        fontFamily: "serif",
        linkId: "",
    };

    return { item: { ...fallback, ch }, index };
}

function graphemes(text, segmenter) {
    return Array.from(segmenter.segment(text), (part) => part.segment);
}

function canvasFont(baseStyle, overrides = {}) {
    const fontStyle = overrides.fontStyle || baseStyle.fontStyle || "normal";
    const fontWeight = overrides.fontWeight || baseStyle.fontWeight || "300";
    const fontSize = overrides.fontSize || baseStyle.fontSize || "24px";
    const fontFamily = overrides.fontFamily || baseStyle.fontFamily || "serif";
    const variant = (overrides.fontVariant || baseStyle.fontVariant || "").includes("small-caps")
        ? "small-caps"
        : "";

    return [fontStyle, variant, fontWeight, fontSize, fontFamily].filter(Boolean).join(" ");
}

function measureGrapheme(context, ch, font) {
    context.font = font;
    return context.measureText(ch === "\u00a0" ? " " : ch).width;
}

function px(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function isCollapsibleSpace(ch) {
    return ch !== "\u00a0" && /\s/.test(ch);
}

function sameGrapheme(a, b) {
    if ((a === " " || a === "\u00a0") && (b === " " || b === "\u00a0")) return true;
    return a === b;
}

function centerX(letter) {
    return letter.x + letter.w / 2;
}

function centerY(letter) {
    return letter.y + letter.h / 2;
}

function originCenterX(letter) {
    return letter.ox + letter.w / 2;
}

function originCenterY(letter) {
    return letter.oy + letter.h / 2;
}

function gridKey(x, y, cellSize) {
    return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}

function viewportWidth() {
    return document.documentElement.clientWidth || window.innerWidth;
}

function viewportHeight() {
    return document.documentElement.clientHeight || window.innerHeight;
}

function pageScrollRemaining() {
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || document.body.scrollTop || 0;
    return Math.max(0, doc.scrollHeight - viewportHeight() - scrollTop);
}

function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}
