import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Background
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        subtle: "var(--color-subtle)",

        // Text
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-tertiary": "var(--color-text-tertiary)",
        "text-disabled": "var(--color-text-disabled)",
        "text-placeholder": "var(--color-text-placeholder)",

        // CTA
        cta: "var(--color-cta)",
        "cta-text": "var(--color-cta-text)",

        // Accent
        accent: "var(--color-accent)",
        "accent-light": "var(--color-accent-light)",

        // States
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        error: "var(--color-error)",
        info: "var(--color-info)",

        // Status
        available: "var(--color-available)",
        completed: "var(--color-completed)",
        locked: "var(--color-locked)",

        // Legacy
        primary: "var(--color-primary)",
        secondary: "var(--color-secondary)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        nav: "var(--shadow-nav)",
        sheet: "var(--shadow-sheet)",
        float: "var(--shadow-float)",
        none: "none",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
        slow: "var(--duration-slow)",
      },
    },
  },
  plugins: [],
};

export default config;
