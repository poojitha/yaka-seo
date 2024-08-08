package linkr

import "net/url"

type Link struct {
	URL    string
	Host   string
	Scheme string
}

/**
Parses a given URL and extracts its essential components.

Args:fullURL (string): The URL to be parsed.
Returns: (Link, error):
*/
func ParseLink(fullURL string) (Link, error) {
	parsedURL, err := url.Parse(fullURL)
	if err != nil {
		return Link{}, err
	}

	return Link{
		URL:    fullURL,
		Host:   parsedURL.Host,
		Scheme: parsedURL.Scheme,
	}, nil

}
