/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Design tokens — web/CLAUDE.md § 3.1 (mirrored in mobile_app/lib/config/theme.dart)
      // Light / dark theme: these follow CSS variables (src/styles/index.css). "white" is the main
      // text / foreground colour and "black" the opposite, so text-white, bg-white/5 and bg-black/20
      // adapt to the theme. Text on solid accent backgrounds uses "onaccent" (always white).
      colors: {
        white: 'rgb(var(--c-fg) / <alpha-value>)',
        black: 'rgb(var(--c-contrast) / <alpha-value>)',
        onaccent: '#ffffff',
        glass: {
          light: 'var(--glass-light)',
          border: 'var(--glass-border)',
          hover: 'var(--glass-hover)',
        },
        accent: {
          primary: '#6366f1',
          glow: '#818cf8',
          danger: '#ef4444',
          warn: '#f59e0b',
          ok: '#10b981',
        },
        ink: {
          950: 'rgb(var(--c-ink-950) / <alpha-value>)',
          900: 'rgb(var(--c-ink-900) / <alpha-value>)',
          800: 'rgb(var(--c-ink-800) / <alpha-value>)',
          muted: 'rgb(var(--c-muted) / <alpha-value>)',
        },
      },
      boxShadow: {
        'depth-1': '0 1px 2px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.06)',
        'depth-2': '0 4px 8px rgba(0,0,0,0.10), 0 8px 16px rgba(0,0,0,0.08)',
        'depth-3': '0 10px 20px rgba(0,0,0,0.12), 0 20px 40px rgba(0,0,0,0.10)',
        glow: '0 0 24px rgba(99,102,241,0.45)',
        'glow-danger': '0 0 24px rgba(239,68,68,0.55)',
      },
      backdropBlur: { glass: '12px' },
      animation: {
        float: 'float 6s ease-in-out infinite',
        tilt: 'tilt 0.3s ease-out',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        mesh: 'mesh 24s ease-in-out infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        tilt: {
          '0%': { transform: 'perspective(800px) rotateX(0deg)' },
          '100%': { transform: 'perspective(800px) rotateX(2deg)' },
        },
        mesh: {
          '0%': { transform: 'translate3d(0,0,0) scale(1)' },
          '100%': { transform: 'translate3d(-4%,3%,0) scale(1.08)' },
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      maxWidth: { content: '1280px' },
    },
  },
  plugins: [],
};
