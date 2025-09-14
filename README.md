# 🔐 Vue Password Generator

A modern, secure password generator built with Vue 3 and Vite. Generate customizable passwords with multiple generation modes including simple passwords, advanced character control, word-based passwords, numeric passwords, and passphrases.

![Vue Password Generator Screenshot](https://via.placeholder.com/800x400/667eea/ffffff?text=Vue+Password+Generator)

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
- **Real-time Feedback**: Instant password strength assessment and visual indicators

### 🔒 **Security & Privacy**
- **Client-side Only**: All generation happens in your browser - no data sent to servers
- **Cryptographically Secure**: Uses browser's secure random number generation
- **No Storage**: Passwords are never stored or logged anywhere
- **Open Source**: Full transparency - inspect the code yourself

### 🛠️ **Technical Excellence**
- **Vue 3**: Built with the latest Vue.js framework using Composition API
- **Vite**: Lightning-fast development and optimized production builds
- **Modern CSS**: Custom properties, Grid, Flexbox, and smooth animations
- **TypeScript Ready**: Structured for easy TypeScript migration
- **PWA Ready**: Can be easily extended to work offline

## 🚀 Live Demo

**[Try it now →](https://your-username.github.io/vue-password-generator)**

## 📸 Screenshots

| Simple Mode | Advanced Mode | Words Mode |
|-------------|---------------|------------|
| ![Simple](https://via.placeholder.com/250x150/2563eb/ffffff?text=Simple) | ![Advanced](https://via.placeholder.com/250x150/10b981/ffffff?text=Advanced) | ![Words](https://via.placeholder.com/250x150/f59e0b/ffffff?text=Words) |

## 🛠️ Development

### Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **npm** or **yarn** package manager
- **Git** for version control

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-username/vue-password-generator.git
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

# Deployment
npm run deploy       # Build and deploy to GitHub Pages
```

## 🚀 Deployment

### Automatic Deployment (Recommended)

This project includes GitHub Actions for automatic deployment:

1. **Fork or clone** this repository
2. **Update configuration**:
   - Edit `vite.config.js` - change the `base` path to your repository name
   - Update `package.json` - change repository URLs to your GitHub username
3. **Push to GitHub** - the site will automatically deploy to GitHub Pages
4. **Enable GitHub Pages** in your repository settings (if not already enabled)

### Manual Deployment

```bash
# Build and deploy manually
npm run build
npm run deploy
```

### Custom Domain

To use a custom domain:

1. Add a `CNAME` file to the `public` directory with your domain
2. Configure your domain's DNS to point to GitHub Pages
3. Enable custom domain in GitHub Pages settings

## 🏗️ Project Structure

```
vue-password-generator/
├── public/                 # Static assets
├── src/
│   ├── components/        # Vue components
│   │   ├── SimplePassword.vue
│   │   ├── AdvancedPassword.vue
│   │   ├── WordsPassword.vue
│   │   ├── NumbersPassword.vue
│   │   └── Passphrase.vue
│   ├── data/             # Word lists and data files
│   │   ├── nouns.txt
│   │   ├── verbs.txt
│   │   └── adjectives.txt
│   ├── App.vue           # Main application component
│   ├── main.js           # Application entry point
│   └── style.css         # Global styles
├── .github/workflows/    # GitHub Actions
├── package.json
├── vite.config.js
└── README.md
```

## 🔧 Configuration

### Customizing Word Lists

The word lists are located in `src/data/` and can be customized:

- `nouns.txt` - Common nouns for word-based passwords
- `verbs.txt` - Action verbs for passphrases
- `adjectives.txt` - Descriptive adjectives for passphrases

### Styling Customization

The app uses CSS custom properties for easy theming. Edit `src/style.css`:

```css
:root {
  --primary: #2563eb;        /* Primary color */
  --success: #10b981;        /* Success color */
  --warning: #f59e0b;        /* Warning color */
  --error: #ef4444;          /* Error color */
  /* ... more variables */
}
```

## 🧠 Password Generation Algorithms

### Simple Mode
- Uses cryptographically secure random selection
- Configurable character sets (lowercase, uppercase, numbers, symbols)
- Adjustable length from 6-128 characters
- Real-time strength assessment

### Advanced Mode
- Minimum/maximum character count controls for each type
- Custom symbol set configuration
- Ensures password meets specific requirements
- Intelligent character distribution

### Words Mode
- Curated dictionary of common English words
- Multiple separator options (symbols, numbers, custom)
- Various capitalization schemes (title, random, alternating)
- Configurable word count (2-20 words)

### Numbers Mode
- Intelligent repetition prevention
- Sequential digit detection and limiting
- Configurable length and constraints
- Balanced randomness with usability

### Passphrase Mode
- Grammar-based generation using parts of speech
- Configurable sentence structure
- Natural language patterns for memorability
- Extensive customization options

## 🔒 Security Features

- **No Network Requests**: All generation happens client-side
- **Secure Random Generation**: Uses `crypto.getRandomValues()` when available
- **No Data Persistence**: Passwords are never stored or logged
- **Memory Safety**: Generated passwords are not kept in memory longer than necessary
- **Open Source**: Full code transparency for security auditing

## 🌟 Browser Support

- **Chrome** 88+
- **Firefox** 85+
- **Safari** 14+
- **Edge** 88+

*Note: Older browsers may work but are not officially supported*

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

### Reporting Issues
- Use the [GitHub Issues](https://github.com/your-username/vue-password-generator/issues) page
- Include browser version, steps to reproduce, and expected behavior
- Check existing issues before creating new ones

### Contributing Code
1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Make** your changes following the existing code style
4. **Test** your changes thoroughly
5. **Commit** your changes (`git commit -m 'Add amazing feature'`)
6. **Push** to your branch (`git push origin feature/amazing-feature`)
7. **Open** a Pull Request

### Development Guidelines
- Follow Vue 3 Composition API patterns
- Maintain responsive design principles
- Add comments for complex logic
- Test on multiple browsers and devices
- Update documentation as needed

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
- [SCOWL (Spell Checker Oriented Word Lists)](http://wordlist.aspell.net/)

### Inspiration
- [XKCD Password Strength Comic](https://xkcd.com/936/)
- [XKPassword Generator](https://xkpasswd.net/s/)
- [Bitwarden Password Generator](https://bitwarden.com/password-generator/)

### Technologies
- [Vue.js](https://vuejs.org/) - The Progressive JavaScript Framework
- [Vite](https://vitejs.dev/) - Next Generation Frontend Tooling
- [Material Design Icons](https://materialdesignicons.com/) - Beautiful iconography

## 📊 Project Stats

![GitHub stars](https://img.shields.io/github/stars/your-username/vue-password-generator?style=social)
![GitHub forks](https://img.shields.io/github/forks/your-username/vue-password-generator?style=social)
![GitHub issues](https://img.shields.io/github/issues/your-username/vue-password-generator)
![GitHub license](https://img.shields.io/github/license/your-username/vue-password-generator)
![GitHub last commit](https://img.shields.io/github/last-commit/your-username/vue-password-generator)

---

<div align="center">

**[⭐ Star this project](https://github.com/your-username/vue-password-generator)** if you find it useful!

Made with ❤️ by [Your Name](https://github.com/your-username)

</div>