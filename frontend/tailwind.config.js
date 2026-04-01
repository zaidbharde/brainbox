/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        panel: '#0f1726',
        border: '#2a3446',
        accent: '#5dc0ff',
        accent2: '#8bffbe',
      },
      boxShadow: {
        panel: '0 18px 45px rgba(0,0,0,0.35)',
      },
      fontFamily: {
        sans: ['"Space Grotesk"', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
