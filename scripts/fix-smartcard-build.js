/**
 * Workaround: node-gyp may generate ClangCL as the PlatformToolset
 * when VS Build Tools has Clang installed. This script patches the
 * generated vcxproj to use v143 (MSVC) instead, then rebuilds.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const smartcardDir = path.join(__dirname, '..', 'node_modules', 'smartcard');
if (!fs.existsSync(smartcardDir)) {
  console.log('smartcard not installed, skipping fix');
  process.exit(0);
}

const vcxproj = path.join(smartcardDir, 'build', 'smartcard_napi.vcxproj');

// Run configure first
try {
  execSync('npx node-gyp configure', { cwd: smartcardDir, stdio: 'inherit' });
} catch {
  console.error('node-gyp configure failed');
  process.exit(1);
}

// Patch ClangCL -> v143 if present
if (fs.existsSync(vcxproj)) {
  let content = fs.readFileSync(vcxproj, 'utf8');
  if (content.includes('ClangCL')) {
    content = content.replace(/ClangCL/g, 'v143');
    fs.writeFileSync(vcxproj, content);
    console.log('Patched smartcard vcxproj: ClangCL -> v143');
  }
}

// Build
try {
  execSync('npx node-gyp build', { cwd: smartcardDir, stdio: 'inherit' });
  console.log('smartcard native module built successfully');
} catch {
  console.error('smartcard build failed');
  process.exit(1);
}
