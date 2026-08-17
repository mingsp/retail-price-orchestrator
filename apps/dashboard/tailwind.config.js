/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.25rem" }],
        sm: ["0.9375rem", { lineHeight: "1.375rem" }],
        base: ["1rem", { lineHeight: "1.5rem" }]
      },
      colors: {
        radar: {
          ink: "#0f172a",
          muted: "#64748b",
          line: "#e2e8f0",
          panel: "rgba(255, 255, 255, 0.92)",
          blue: "#2563eb",
          indigo: "#3730a3",
          cyan: "#0891b2",
          green: "#16a34a",
          amber: "#d97706",
          red: "#dc2626"
        }
      },
      boxShadow: {
        soft: "0 10px 30px -5px rgba(15, 23, 42, 0.05), 0 4px 12px -2px rgba(15, 23, 42, 0.03)",
        card: "0 4px 20px -4px rgba(15, 23, 42, 0.04)",
        glow: "0 20px 50px rgba(15, 23, 42, 0.18)"
      }
    }
  },
  plugins: []
};
