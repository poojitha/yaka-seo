package utils

import (
	"fmt"
	"os/exec"
	"runtime"
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
