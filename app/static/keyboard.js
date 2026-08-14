(function () {
  let activeInput = null;
  let isShift = false;
  let isSymbols = false;

  const LAYOUT_LOWER = [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["shift", "z", "x", "c", "v", "b", "n", "m", "backspace"],
    ["sym", "space", "enter", "hide"]
  ];

  const LAYOUT_UPPER = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["shift", "Z", "X", "C", "V", "B", "N", "M", "backspace"],
    ["sym", "space", "enter", "hide"]
  ];

  const LAYOUT_SYMBOLS = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["@", "#", "$", "%", "&", "-", "+", "(", ")", "/"],
    ["abc", "*", "\"", "'", ":", ";", "!", "?", "backspace"],
    ["abc", "space", "enter", "hide"]
  ];

  let keyboardEl = null;

  function initKeyboard() {
    // Skip custom web keyboard on native mobile OS (iOS/Android) so native keyboard is used
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return;
    if (document.getElementById("virtual-keyboard")) return;

    keyboardEl = document.createElement("div");
    keyboardEl.id = "virtual-keyboard";
    keyboardEl.className = "vk-container hidden";
    keyboardEl.setAttribute("aria-hidden", "true");

    // Prevent clicking keys from stealing focus from active input
    keyboardEl.addEventListener("mousedown", (e) => e.preventDefault());
    keyboardEl.addEventListener("touchstart", (e) => e.preventDefault());

    document.body.appendChild(keyboardEl);
    renderKeyboard();

    function checkTarget(target) {
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
        target.type !== "checkbox" &&
        target.type !== "radio" &&
        target.type !== "color" &&
        target.type !== "submit" &&
        target.type !== "button"
      ) {
        showKeyboard(target);
      }
    }

    // Listen for input focus across document
    document.addEventListener("focusin", (e) => checkTarget(e.target));

    document.addEventListener("click", (e) => {
      const target = e.target;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      const isKb = keyboardEl && keyboardEl.contains(target);

      if (isInput) {
        checkTarget(target);
      } else if (activeInput && !isKb) {
        hideKeyboard();
      }
    });

    // Check if an input is already focused on page load (e.g. via autofocus)
    if (document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA")) {
      checkTarget(document.activeElement);
    }
  }

  function getLayout() {
    if (isSymbols) return LAYOUT_SYMBOLS;
    return isShift ? LAYOUT_UPPER : LAYOUT_LOWER;
  }

  function renderKeyboard() {
    if (!keyboardEl) return;
    const layout = getLayout();

    let html = `
      <div class="vk-header">
        <span class="vk-title">⌨️ Touch Keyboard</span>
        <button type="button" class="vk-close-btn" data-action="hide">Done ✕</button>
      </div>
      <div class="vk-keys">
    `;

    layout.forEach((row) => {
      html += `<div class="vk-row">`;
      row.forEach((key) => {
        let keyClass = "vk-key";
        let label = key;

        if (key === "shift") {
          keyClass += ` vk-key-special ${isShift ? "vk-active" : ""}`;
          label = "⇧";
        } else if (key === "backspace") {
          keyClass += " vk-key-special vk-key-backspace";
          label = "⌫";
        } else if (key === "sym") {
          keyClass += " vk-key-special";
          label = "?123";
        } else if (key === "abc") {
          keyClass += " vk-key-special";
          label = "ABC";
        } else if (key === "space") {
          keyClass += " vk-key-space";
          label = "Space";
        } else if (key === "enter") {
          keyClass += " vk-key-enter";
          label = "Enter ↵";
        } else if (key === "hide") {
          keyClass += " vk-key-special vk-key-hide";
          label = "Hide ⌨";
        }

        html += `<button type="button" class="${keyClass}" data-key="${key}">${label}</button>`;
      });
      html += `</div>`;
    });

    html += `</div>`;
    keyboardEl.innerHTML = html;

    // Attach button handlers
    keyboardEl.querySelectorAll(".vk-key, .vk-close-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.key || btn.dataset.action;
        handleKeyPress(action);
      });
    });
  }

  function handleKeyPress(key) {
    if (!activeInput) return;

    if (key === "hide") {
      hideKeyboard();
      return;
    }

    if (key === "shift") {
      isShift = !isShift;
      renderKeyboard();
      return;
    }

    if (key === "sym") {
      isSymbols = true;
      renderKeyboard();
      return;
    }

    if (key === "abc") {
      isSymbols = false;
      renderKeyboard();
      return;
    }

    const start = activeInput.selectionStart ?? activeInput.value.length;
    const end = activeInput.selectionEnd ?? activeInput.value.length;
    let val = activeInput.value;

    if (key === "backspace") {
      if (start === end && start > 0) {
        val = val.substring(0, start - 1) + val.substring(start);
        activeInput.value = val;
        activeInput.setSelectionRange(start - 1, start - 1);
      } else if (start !== end) {
        val = val.substring(0, start) + val.substring(end);
        activeInput.value = val;
        activeInput.setSelectionRange(start, start);
      }
    } else {
      const charToAdd = key === "space" ? " " : key === "enter" ? "" : key;
      val = val.substring(0, start) + charToAdd + val.substring(end);
      activeInput.value = val;
      if (key !== "enter") {
        activeInput.setSelectionRange(start + charToAdd.length, start + charToAdd.length);
      }
    }

    // Dispatch input & change events for reactive listeners
    activeInput.dispatchEvent(new Event("input", { bubbles: true }));
    activeInput.dispatchEvent(new Event("change", { bubbles: true }));

    if (key === "enter") {
      // Dispatch Enter keydown event
      activeInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
      hideKeyboard();
    } else if (isShift) {
      // Auto-turn off shift after one letter tap
      isShift = false;
      renderKeyboard();
    }
  }

  function showKeyboard(inputEl) {
    activeInput = inputEl;
    if (!keyboardEl) initKeyboard();
    keyboardEl.classList.remove("hidden");
    keyboardEl.setAttribute("aria-hidden", "false");
    document.body.classList.add("vk-open");

    // Scroll active element into view so keyboard doesn't cover it
    setTimeout(() => {
      activeInput.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }

  function hideKeyboard() {
    if (keyboardEl) {
      keyboardEl.classList.add("hidden");
      keyboardEl.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("vk-open");
    if (activeInput) {
      activeInput.blur();
      activeInput = null;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initKeyboard);
  } else {
    initKeyboard();
  }
})();
