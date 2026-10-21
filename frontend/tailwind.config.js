/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Design tokens — styles/ per Frontend Spec §1
        primary: {
          50: '#eef7ff',
          100: '#d9edff',
          500: '#1a7fd4',
          600: '#146bb5',
          700: '#115a99',
          900: '#0d3d68',
        },
      },
    },
  },
  plugins: [],
};
