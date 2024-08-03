package utils

import (
	"crypto/sha256"
	"encoding/hex"
	"log"

	"github.com/joho/godotenv"
)

/*
Load the environment variables
*/
func LoadEnvs() {
	err := godotenv.Load()
	if err != nil {
		log.Fatal("Error loading .env file")
	}
}

/*
Hash generates an SHA-256 hash of the input string and returns the first 'length' characters of the hash as a string.
- str: The input string to be hashed.
- length: The number of characters to be returned from the beginning of the hashed string.
- Returns: A string representing the first 'length' characters of the SHA-256 hash of the input string.
*/

func Hash(str string, length int) (string, error) {
	hasher := sha256.New()
	if _, err := hasher.Write([]byte(str)); err != nil {
		return "", err
	}
	hashedBytes := hasher.Sum(nil)
	hashedString := hex.EncodeToString(hashedBytes)
	return hashedString[:length], nil
}
