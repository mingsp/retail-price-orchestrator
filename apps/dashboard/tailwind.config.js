/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        radar: {
          ink: "#0f172a",
          muted: "#64748b",
          line: "#dbe4ee",
          panel: "rgba(255,255,255,0.78)",
          blue: "#2563eb",
          indigo: "#3730a3",
          cyan: "#0891b2",
          green: "#16a34a",
          amber: "#d97706",
          red: "#dc2626"
        }
      },
      boxShadow: {
        soft: "0 18px 50px rgba(15, 23, 42, 0.10)",
        glow: "0 16px 48px rgba(37, 99, 235, 0.22)"
      }
    }
  },
  plugins: []
};
