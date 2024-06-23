package main

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/poojitha/yaka-seo/utils"
	"github.com/poojitha/yaka-seo/webpage"
	"golang.org/x/net/html"
)

func init() {
	utils.LoadEnvs()
}

func extractLinks(n *html.Node, hrefs *[]string) {
	if n == nil {
		return
	}

	if n.Type == html.ElementNode && n.Data == "a" {
		for _, attr := range n.Attr {
			if attr.Key == "href" {
				*hrefs = append(*hrefs, attr.Val)
			}
		}
	}

	// Recursively call for child nodes
	extractLinks(n.FirstChild, hrefs)
}

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
					fmt.Println(attr.Val)
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

func main() {
	links, err := getHrefs("https://optimumpet.com.au")
	if err != nil {
		fmt.Println(links)
	}

	r := gin.Default()
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "here",
		})
	})
	r.Run()
}
