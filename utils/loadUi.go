package utils

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

func LoadUi() {

	var PORT = os.Getenv("PORT")
	var BASE_URL = os.Getenv("BASE_URL")

	if PORT == "" {
		PORT = "3837"
	}

	if BASE_URL == "" {
		BASE_URL = "http://localhost"
	}

	var err error
	var loadUrl = " --app=" + BASE_URL + ":" + PORT

	switch runtime.GOOS {
	case "windows":
		cmd := exec.Command("cmd", "/c", "start", "chrome", loadUrl)
		err = cmd.Start()
		if err == nil {
			err = cmd.Wait()
		}
	case "darwin":
		cmd := exec.Command("open", "-a", "Google Chrome", loadUrl)
		err = cmd.Start()
		if err == nil {
			err = cmd.Wait()
		}
	case "linux":
		cmd := exec.Command("google-chrome", loadUrl)
		err = cmd.Start()
		if err == nil {
			err = cmd.Wait()
		}
	default:
		fmt.Println("Please install google chrome browser to run this application")
		return
	}

	if err != nil {
		fmt.Println(err)
	}
}
