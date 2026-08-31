module github.com/fuomag9/caddy-proxy-manager/docker/caddy

go 1.26.0

// caddy-blocker-plugin tracks Caddy master and currently requests cel-go
// v0.29.0, whose InterpretableV2 API is incompatible with Caddy v2.11.4.
// Keep the reviewed stable Caddy build on its own cel-go version; the image
// build test must pass before Dependabot can merge an update to this pin.
replace github.com/google/cel-go => github.com/google/cel-go v0.28.1
