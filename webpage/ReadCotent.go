package webpage

import (
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/poojitha/yaka-seo/linkr"
	"github.com/poojitha/yaka-seo/utils"
)

type uniqUrlMap[K comparable, V any] map[K]V

func ReadCotent(url string) (string, error) {
	// Create a new HTTP client
	client := &http.Client{
		Timeout: time.Duration(5) * time.Second,
	}

	// Set custom headers to mimic a browser
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")

	// Send the request
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// Read the response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	// Return the content as string
	return string(body), nil
}

/*
GetPageLinks retrieves a map of unique links from a given URL.
-url string: The URL from which to retrieve page links.
-Returns: (uniqUrlMap[string, string], error): A map of unique URLs and an error if any occurred during the process.
*/
func GetPageLinks(url string) (uniqUrlMap[string, string], error) {
	mainHost, parseLinkError := linkr.ParseLink(url)
	if parseLinkError != nil {
		return uniqUrlMap[string, string]{}, parseLinkError
	}

	pageContent, readContentError := ReadCotent(mainHost.Scheme + "://" + mainHost.Host)
	if readContentError != nil {
		return uniqUrlMap[string, string]{}, readContentError
	}

	uniqueUrls := uniqUrlMap[string, string]{}

	if pageContent != "" {
		links, tagValueError := GetTagValues(pageContent, "a", "href")
		if tagValueError != nil {
			return uniqUrlMap[string, string]{}, tagValueError
		}

		var loopLinks func(links []string)
		loopLinks = func(links []string) {
			for i := 0; i < len(links); i++ {
				if strings.Contains(links[i], mainHost.Host) {
					hash, hashError := utils.Hash(links[i], 15)
					if hashError == nil {
						if _, ok := uniqueUrls[hash]; !ok {
							uniqueUrls[hash] = links[i]
							pageContent, err := ReadCotent(links[i])
							if err == nil {
								links2, _ := GetTagValues(pageContent, "a", "href")
								go loopLinks(links2)
							}

						}
					}
				}
			}
		}

		loopLinks(links)
	}

	return uniqueUrls, nil
}
