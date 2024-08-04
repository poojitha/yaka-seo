package link

import "net/url"

type Link struct {
	url  string
	host string
}

func ParseLink(fullURL string) (Link, error) {
	parsedURL, err := url.Parse(fullURL)
	if err != nil {
		return Link{}, err
	}

	return Link{
		url:  fullURL,
		host: parsedURL.Host,
	}, nil

}
