tailwind.config = {
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f5ff',
          100: '#dde8ff',
          200: '#c0d4ff',
          300: '#95b6ff',
          400: '#6492ff',
          500: '#2b70ef',
          600: '#2250df',
          700: '#1a40b5',
          800: '#13318d',
          900: '#0e266a',
          950: '#07194e',
        },
        body: '#3d4b5f',
        wf: {
          bg: 'var(--wf-bg)',
          surface: 'var(--wf-surface)',
          border: 'var(--wf-border)',
          text: 'var(--wf-text)',
          'text-sub': 'var(--wf-text-sub)',
          accent: 'var(--wf-accent)',
        },
      },
      fontFamily: {
        sans: ['Inter','Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','sans-serif'],
        mono: ['JetBrains Mono','SF Mono','monospace'],
      },
      fontSize: {
        xxs: ['0.625rem', { lineHeight: '1.4' }],
        xs: ['0.8125rem', { lineHeight: '1.4' }],
        sm: ['0.9375rem', { lineHeight: '1.7' }],
        base: ['1.125rem', { lineHeight: '2.0' }],
        lg: ['1.25rem', { lineHeight: '1.5' }],
        xl: ['1.375rem', { lineHeight: '1.4' }],
        2xl: ['1.625rem', { lineHeight: '1.4' }],
        3xl: ['2rem', { lineHeight: '1.4' }],
      },
    },
  },
}
