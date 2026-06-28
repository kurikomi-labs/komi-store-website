source "https://rubygems.org"

# Local preview toolchain only. github.io deploys via classic GitHub Pages
# (server-side build), which ignores this Gemfile — so a modern Jekyll here
# is deploy-safe and runs natively on current Ruby.
gem "jekyll", "~> 4.3"
gem "webrick"

group :jekyll_plugins do
  gem "jekyll-sitemap"
  gem "jekyll-redirect-from"
end

# _config.yml uses kramdown GFM input
gem "kramdown-parser-gfm"

# stdlib gems no longer bundled by default on newer Ruby
gem "csv"
gem "base64"
gem "logger"
gem "bigdecimal"
