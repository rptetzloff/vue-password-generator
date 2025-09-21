# 🔐 Vue Password Generator

A modern, secure password generator built with Vue 3. Generate customizable passwords with multiple generation modes including simple passwords, advanced character control, word-based passwords, numeric passwords, and passphrases.

## ✨ Features

### 🎯 **Multiple Generation Modes**
- **Simple Mode**: Quick password generation with basic character type selection
- **Advanced Mode**: Fine-grained control over character counts and custom symbol sets
- **Words Mode**: Dictionary-based passwords with customizable separators and capitalization
- **Numbers Mode**: Numeric passwords with intelligent repetition and sequence controls
- **Passphrase Mode**: Grammar-based passphrases using adjectives, nouns, and verbs

### 🎨 **Modern User Experience**
- **Beautiful UI**: Clean, modern design with gradient backgrounds and smooth animations
- **Fully Responsive**: Optimized for desktop, tablet, and mobile devices
- **Dark Theme Ready**: Professional color scheme with excellent contrast
- **Intuitive Controls**: Sliders, checkboxes, and radio buttons for easy customization
- **Real-time Generation**: Instant password creation with visual feedback

### 🔒 **Security & Privacy**
- **Client-side Only**: All generation happens in your browser - no data sent to servers
- **Cryptographically Secure**: Uses browser's secure random number generation (`crypto.getRandomValues()`)
- **No Storage**: Passwords are never stored, logged, or transmitted anywhere
- **SRI Protected**: CDN resources use Subresource Integrity hashes for tamper protection
- **Open Source**: Full transparency - inspect the code yourself

### 🛠️ **Technical Excellence**
- **Vue 3**: Built with Vue.js using CDN delivery for maximum compatibility
- **Vite**: Lightning-fast development and optimized production builds
- **Modern CSS**: Custom properties, Grid, Flexbox, and smooth animations
- **Static Deployment**: Optimized for static hosting platforms like Render.com
- **No Dependencies**: Minimal external dependencies for security and reliability

## 🚀 Live Demo

**[Try it now →](https://getrandompassword.net)**

## 📸 Screenshots

The application features five distinct generation modes:

- **Simple**: Basic password generation with character type toggles
- **Advanced**: Precise control over minimum/maximum character counts
- **Words**: Dictionary-based passwords with customizable formatting
- **Numbers**: Numeric passwords with repetition and sequence controls
- **Passphrase**: Grammar-based sentences with customizable structure

## 🛠️ Development

### Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **npm** or **yarn** package manager
- **Git** for version control

### Quick Start

```bash
# Clone the repository
git clone https://github.com/rptetzloff/vue-password-generator.git
cd vue-password-generator

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to view the app in development mode.

### Available Scripts

```bash
# Development
npm run dev          # Start development server with hot reload
npm run build        # Build for production
npm run preview      # Preview production build locally
```

## 🚀 Deployment

### Deploy on Render.com (Recommended)

This project is optimized for Render.com deployment with the included `render.yaml` configuration:

1. **Connect your repository** to Render.com
2. **Create a new Static Site** service
3. **Render will automatically detect** the `render.yaml` configuration
4. **Deploy** - Render will build and deploy your site automatically
5. **Auto-deploy** - Future commits trigger automatic deployments

The build configuration:
- **Build Command**: `npm ci && npm run build`
- **Publish Directory**: `dist`
- **Security Headers**: Includes security headers for production

### Alternative Deployment

For other static hosting providers:

```bash
# Build for production
npm run build

# The dist/ folder contains the built application
# Upload the contents to your static hosting provider
```

### Environment Variables

No environment variables are required - this is a fully client-side application.

## 🏗️ Project Structure

```
vue-password-generator/
├── public/                 # Static assets
├── src/
│   ├── data/              # Word lists for generation
│   │   ├── nouns.txt      # Common nouns (1000+ words)
│   │   ├── verbs.txt      # Action verbs (500+ words)
│   │   └── adjectives.txt # Descriptive adjectives (500+ words)
│   ├── main.js            # Main application with all components
│   └── style.css          # Global styles and design system
├── render.yaml            # Render.com deployment configuration
├── package.json           # Dependencies and scripts
├── vite.config.js         # Vite build configuration
└── index.html             # HTML entry point
```

## 🔧 Architecture

### Component Structure

The application uses Vue 3's Composition API with five main components:

- **SimplePassword**: Basic character-type selection
- **AdvancedPassword**: Granular character count controls
- **WordsPassword**: Dictionary-based generation
- **NumbersPassword**: Numeric password generation
- **Passphrase**: Grammar-based sentence generation

### CDN Approach

The project uses Vue 3 via CDN for maximum compatibility and deployment simplicity:

```javascript
// Pinned version with SRI hash for security
import { createApp, ref, onMounted } from 'https://unpkg.com/vue@3.4.0/dist/vue.esm-browser.prod.js'
```

Benefits:
- No complex build configuration
- Reliable deployment across platforms
- Reduced bundle size
- Faster initial development setup

## 🧠 Password Generation Algorithms

### Simple Mode
- Cryptographically secure random selection using `crypto.getRandomValues()`
- Configurable character sets (lowercase, uppercase, numbers, symbols)
- Length range: 6-128 characters
- Ensures at least one character type is selected

### Advanced Mode
- Minimum/maximum character count controls for each type
- Custom symbol set configuration
- Intelligent character distribution algorithm
- Validates requirements before generation

### Words Mode
- Curated dictionary of 1000+ common English words
- Multiple separator options (symbols, numbers, spaces, custom)
- Capitalization schemes: title case, lowercase, uppercase, random
- Word count range: 2-20 words

### Numbers Mode
- Intelligent repetition prevention (configurable limit)
- Sequential digit detection and limiting
- Length range: 4-32 digits
- Balanced randomness with usability constraints

### Passphrase Mode
- Grammar-based generation using parts of speech
- Configurable sentence structure (adjective + noun + verb)
- Multiple word lists: 1000+ nouns, 500+ verbs, 500+ adjectives
- Optional numeric and symbol prefixes/suffixes

## 🔒 Security Implementation

### Client-Side Generation
- **Zero server communication** during password generation
- All randomness generated locally using `crypto.getRandomValues()`
- No network requests to external password services
- Passwords never leave the user's browser

### Secure Randomness
```javascript
// Uses cryptographically secure random number generation
const secureRandom = crypto.getRandomValues(new Uint32Array(1))[0]
const randomIndex = secureRandom % charset.length
```

### Memory Safety
- Generated passwords are not stored in variables longer than necessary
- No password history or caching
- Clipboard operations use secure browser APIs

### CDN Security
- **Subresource Integrity (SRI)** hashes verify CDN content integrity
- **Pinned versions** prevent unexpected updates
- **HTTPS-only** CDN delivery

### Security Headers
Production deployment includes security headers:
```yaml
headers:
  - name: X-Frame-Options
    value: DENY
  - name: X-Content-Type-Options
    value: nosniff
  - name: Referrer-Policy
    value: strict-origin-when-cross-origin
```

## 🌟 Browser Support

- **Chrome** 88+ (recommended)
- **Firefox** 85+
- **Safari** 14+
- **Edge** 88+

*Requires support for ES6 modules and `crypto.getRandomValues()`*

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

### Reporting Issues
- Use [GitHub Issues](https://github.com/rptetzloff/vue-password-generator/issues)
- Include browser version and steps to reproduce
- Check existing issues before creating new ones

### Contributing Code
1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Test** your changes across multiple browsers
4. **Commit** your changes (`git commit -m 'Add amazing feature'`)
5. **Push** to your branch (`git push origin feature/amazing-feature`)
6. **Open** a Pull Request

### Development Guidelines
- Follow Vue 3 Composition API patterns
- Maintain responsive design principles
- Test password generation algorithms thoroughly
- Update word lists responsibly (family-friendly content)
- Preserve security-first approach

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

### What this means:
- ✅ Commercial use allowed
- ✅ Modification allowed
- ✅ Distribution allowed
- ✅ Private use allowed
- ❌ No warranty provided
- ❌ No liability accepted

## 🙏 Acknowledgments

### Word Lists
- [EFF Large Wordlist for Passphrases](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases)
- [Google 10000 English](https://github.com/first20hours/google-10000-english)
- Curated and filtered for family-friendly content

### Inspiration
- [XKCD Password Strength Comic](https://xkcd.com/936/) - "Correct Horse Battery Staple"
- [Bitwarden Password Generator](https://bitwarden.com/password-generator/)
- Modern password security best practices

### Technologies
- [Vue.js](https://vuejs.org/) - The Progressive JavaScript Framework
- [Vite](https://vitejs.dev/) - Next Generation Frontend Tooling
- [Render.com](https://render.com/) - Modern cloud platform

## 📊 Project Stats

![GitHub stars](https://img.shields.io/github/stars/rptetzloff/vue-password-generator?style=social)
![GitHub forks](https://img.shields.io/github/forks/rptetzloff/vue-password-generator?style=social)
![GitHub issues](https://img.shields.io/github/issues/rptetzloff/vue-password-generator)
![GitHub license](https://img.shields.io/github/license/rptetzloff/vue-password-generator)

---

<div align="center">

**🔒 Your passwords are generated locally in your browser - no server storage or transmission**

**[⭐ Star this project](https://github.com/rptetzloff/vue-password-generator)** if you find it useful!

Made with ❤️ and ☕ by [Raymond Tetzloff](https://github.com/rptetzloff)

*This project was developed with assistance from [Bolt AI](https://bolt.new) - an AI-powered development environment.*

</div>