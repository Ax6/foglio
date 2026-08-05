# Homebrew cask for foglio.
#
# Copy this into a tap repo as Casks/foglio.rb — the tap must be named
# `homebrew-tap` (i.e. github.com/Ax6/homebrew-tap) for
# `brew install Ax6/tap/foglio` to resolve.
#
# On each release, update `version` and `sha256` from the release job summary.
cask "foglio" do
  version "0.2.0"
  sha256 "REPLACE_WITH_RELEASE_SHA256"

  url "https://github.com/Ax6/showmd/releases/download/v#{version}/foglio-#{version}-universal.app.tar.gz"
  name "Foglio MD"
  desc "Lightweight, ultra-fast Markdown reader and editor"
  homepage "https://github.com/Ax6/showmd"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :big_sur

  app "Foglio MD.app"
  # The shim inside the bundle uses `open -a`, so `foglio notes.md` reaches the
  # running instance through the same Apple Event path as a Finder double-click.
  binary "#{appdir}/Foglio MD.app/Contents/Resources/foglio"

  # Remove once releases are signed and notarized with a Developer ID.
  postflight do
    system_command "/bin/chmod",
                   args: ["+x", "#{appdir}/Foglio MD.app/Contents/Resources/foglio"],
                   sudo: false
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Foglio MD.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/io.aaronrusso.foglio",
    "~/Library/Caches/io.aaronrusso.foglio",
    "~/Library/Saved Application State/io.aaronrusso.foglio.savedState",
    "~/Library/WebKit/io.aaronrusso.foglio",
  ]

  caveats <<~EOS
    foglio is not yet notarized by Apple. The install removes the quarantine
    flag for you; if macOS still refuses to open it, allow it once under
    System Settings → Privacy & Security → "Open Anyway".

    To make foglio the default for Markdown files, right-click any .md file in
    Finder → Get Info → Open with → foglio → Change All.
  EOS
end
