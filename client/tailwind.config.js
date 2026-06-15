/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      // Tokens do design system Vértice (M12). Consolidam os tons de fundo que
      // antes apareciam como hex soltos (#080C14, #0B101A, #0F131E, ...).
      // Uso: bg-base, bg-card, bg-panel, bg-deep, bg-elevated, text-gold.
      // Valores via CSS custom properties → suportam tema claro/escuro em runtime
      // sem rebuild. Formato "R G B" permite opacity modifiers (bg-base/80).
      colors: {
        base:     'rgb(var(--tw-color-base)     / <alpha-value>)',
        deep:     'rgb(var(--tw-color-deep)     / <alpha-value>)',
        card:     'rgb(var(--tw-color-card)     / <alpha-value>)',
        panel:    'rgb(var(--tw-color-panel)    / <alpha-value>)',
        elevated: 'rgb(var(--tw-color-elevated) / <alpha-value>)',
        gold: {
          DEFAULT: '#D4AF37', // dourado de marca (Vértice)
          light: '#F2D06B',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
'shake': 'shake 0.4s cubic-bezier(.36,.07,.19,.97) both',
        'scroll': 'scroll 40s linear infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          'from': { opacity: '0', transform: 'translateY(10px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
shake: {
          '10%, 90%': { transform: 'translate3d(-1px, 0, 0)' },
          '20%, 80%': { transform: 'translate3d(2px, 0, 0)' },
          '30%, 50%, 70%': { transform: 'translate3d(-3px, 0, 0)' },
          '40%, 60%': { transform: 'translate3d(3px, 0, 0)' },
        },
        scroll: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        shimmer: {
          'from': { backgroundPosition: '0 0' },
          'to': { backgroundPosition: '-200% 0' },
        }
      }
    },
  },
  plugins: [],
}