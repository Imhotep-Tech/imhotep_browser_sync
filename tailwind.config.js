/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{html,ts,tsx,js,jsx}",
    "./src/popup/**/*.{html,ts,tsx,js,jsx}",
    "./popup.html"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        imhotep: {
          gold: '#F59E0B',
          obsidian: '#0F172A',
          cyan: '#06B6D4',
          sand: '#D97706',
          dark: '#0B0F19'
        }
      }
    },
  },
  plugins: [],
}
