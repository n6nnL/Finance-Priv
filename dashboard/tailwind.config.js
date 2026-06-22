/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream: {
          bg: '#F4EEE4',
          card: '#FFFDF9',
          border: '#EAE1D3',
          input: '#E3DACB',
        },
        brand: {
          DEFAULT: '#1F7A6B',
          light: '#2E9E7E',
        },
      },
      fontFamily: {
        display: ['Rubik', 'system-ui', 'sans-serif'],
        body: ['Onest', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '18px',
      },
    },
  },
  plugins: [],
};
