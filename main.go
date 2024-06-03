package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/poojitha/yaka-seo/utils"
)

func init() {
	utils.LoadEnvs()
}

func main() {

	utils.LoadUi()

	r := gin.Default()
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "here",
		})
	})
	r.Run()
}
