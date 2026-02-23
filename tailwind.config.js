/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // DAW dark theme color palette
        daw: {
          bg: "#1a1a1a",
          surface: "#242424",
          panel: "#2d2d2d",
          border: "#3a3a3a",
          accent: "#6c63ff",
          "accent-hover": "#7c73ff",
          text: "#e8e8e8",
          "text-muted": "#888888",
          track: "#2a2a3a",
          "track-active": "#3a3a5a",
          grid: "#333333",
          clip: "#4a4a8a",
          "clip-selected": "#6a6aaa",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
