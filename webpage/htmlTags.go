package webpage

import (
	"bytes"
	"fmt"
	"strings"

	"golang.org/x/net/html"
)

/**
 * GetHrefs extracts a list of GetTagValues attribute values from a provided HTML content string.
 *
 * @param htmlContent The HTML content string to be parsed.
 * @param tagName The HTML tag name of elements to target for attribute extraction.
 * @param attribute The attribute name containing the desired href values.
 *
 * @return A slice of strings containing the extracted href values, or nil with an error if parsing fails.
 */
func GetTagValues(htmlContent string, tagName string, attribute string) ([]string, error) {
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

		if n.Type == html.ElementNode && n.Data == tagName {
			for _, attr := range n.Attr {
				if attr.Key == attribute {
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
