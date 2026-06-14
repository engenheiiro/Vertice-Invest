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
      colors: {
        base: '#080C14', // fundo principal da aplicação
        deep: '#02040a', // fundo mais profundo (listas/áreas internas)
        card: '#0B101A', // superfície de cards
        panel: '#0F131E', // modais / painéis
        elevated: '#0F1729', // hover de inputs e dropdowns
        gold: {
          DEFAULT: '#D4AF37', // dourado de marca (Vértice)
          light: '#F2D06B',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
        'page-enter': 'pageEnter 0.22s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'shake': 'shake 0.4s cubic-bezier(.36,.07,.19,.97) both',
        'scroll': 'scroll 40s linear infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          'from': { opacity: '0', transform: 'translateY(10px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        // Transição de entrada de página: slide-up suave com fade (respeita
        // prefers-reduced-motion via CSS).
        pageEnter: {
          'from': { transform: 'translateY(8px)' },
          'to': { transform: 'translateY(0)' },
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