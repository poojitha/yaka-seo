package webpage

import (
	"bytes"
	"fmt"
	"strings"

	"golang.org/x/net/html"
)

func GetHrefs(htmlContent string) ([]string, error) {
	html.Parse(strings.NewReader(string(htmlContent)))
	reader := bytes.NewReader([]byte(string(htmlContent)))
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
