package utils

import (
	"fmt"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
)

// LoadUi opens the given URL in Google Chrome Incognito mode
func LoadUi(loadUrl string) {
	fmt.Println("Opening browser in Incognito mode at:", loadUrl)

	var err error

	switch runtime.GOOS {
	case "windows":
		// Windows: Open Chrome in Incognito
		err = exec.Command("cmd", "/c", "start", "chrome", "--incognito", loadUrl).Start()
	case "darwin":
		// macOS: Open Chrome in Incognito
		err = exec.Command("open", "-a", "Google Chrome", "--args", "--incognito", loadUrl).Start()
	case "linux":
		// Linux: Open Chrome in Incognito
		err = exec.Command("google-chrome", "--incognito", loadUrl).Start()
	default:
		fmt.Println("Please install Google Chrome to run this application")
		return
	}

	if err != nil {
		fmt.Println("Error opening browser:", err)
	}
}

func StandardizeURL(input string) (string, error) {
	parsedURL, err := url.Parse(input)
	if err != nil {
		return "", err
	}

	// Ensure scheme (default to https if missing)
	if parsedURL.Scheme == "" {
		parsedURL.Scheme = "https"
	}

	// Convert host to lowercase (domains are case-insensitive)
	parsedURL.Host = strings.ToLower(parsedURL.Host)

	// Remove default ports (80 for HTTP, 443 for HTTPS)
	if (parsedURL.Scheme == "http" && parsedURL.Port() == "80") ||
		(parsedURL.Scheme == "https" && parsedURL.Port() == "443") {
		parsedURL.Host = parsedURL.Hostname()
	}

	// Remove fragment (#section)
	parsedURL.Fragment = ""

	// Normalize query parameters (sorted order can be added if needed)

	// Return the standard URL as a string
	return parsedURL.String(), nil
}
