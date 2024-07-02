package web

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/poojitha/yaka-seo/webpage"
	"golang.org/x/net/html"
)

func getHrefs(url string) ([]string, error) {

	content, err := webpage.ReadCotent(url)

	if err != nil {
		fmt.Println(err)
	}

	html.Parse(strings.NewReader(string(content)))

	if err != nil {
		return nil, err
	}

	reader := bytes.NewReader([]byte(string(content)))
	rootNode, err := html.Parse(reader)

	if err != nil {
		fmt.Println("Error parsing HTML:", err)
		return nil, err
	}

	var hrefs []string

	var loopNodes func(*html.Node)

	loopNodes = func(n *html.Node) {
		if n == nil {
			return
		}

		if n.Type == html.ElementNode && n.Data == "a" {
			for _, attr := range n.Attr {
				if attr.Key == "href" {
					hrefs = append(hrefs, attr.Val)
					break
				}
			}
		}

		for c := n.FirstChild; c != nil; c = c.NextSibling {
			loopNodes(c)
		}
	}

	loopNodes(rootNode)

	return hrefs, nil
}
