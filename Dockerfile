FROM golang:1.22.4-bullseye
 
WORKDIR /app
 
# Effectively tracks changes within your go.mod file
COPY go.mod .
 
# RUN go mod download
 
# Copies your source code into the app directory
COPY main.go .
 
RUN go build -o bin .
 
EXPOSE 8080
 
CMD [ "/app/bin" ]