package main

import (
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

func extractLinks(n *html.Node, links chan string) {
	if n.Type == html.ElementNode && n.Data == "a" {
		for _, a := range n.Attr {
			if a.Key == "href" {
				links <- a.Val
			}
		}
	}

	for c := n.FirstChild; c != nil; c = c.NextSibling {
		extractLinks(c, links)
	}
}

func getHrefs(url string) ([]string, error) {

	content, err := webpage.ReadCotent(url)

	if err != nil {
		fmt.Println(err)
	}

	doc, err := html.Parse(strings.NewReader(string(content)))

	if err != nil {
		return nil, err
	}

	hrefs := loopHrefs(doc)

	return hrefs, nil
}

func loopHrefs(n *html.Node) []string {
	var hrefs []string
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
		loopHrefs(c)
	}

	return hrefs
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
