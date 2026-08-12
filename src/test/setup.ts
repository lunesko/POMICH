import '@testing-library/jest-dom/vitest'

if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = `
    [data-sheet-peek] { display: none !important; }
    [data-pomich-theme="dark"] {
      --pomich-bg: #090B0E;
      --pomich-surface: #12151A;
      --pomich-text: #FFFFFF;
      --pomich-border: rgba(255, 255, 255, 0.13);
      --pomich-input-bg: rgba(255, 255, 255, 0.06);
      --pomich-card-bg: #181C24;
    }
    .pomich-form-input {
      color: var(--pomich-text);
      background: var(--pomich-input-bg);
    }
    select.pomich-form-input option {
      background-color: var(--pomich-surface);
      color: var(--pomich-text);
    }
    [data-pomich-theme="dark"] select.pomich-form-input {
      color-scheme: dark;
    }
  `
  document.head.appendChild(style)
}
