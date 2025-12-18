# Use a small, secure Nginx base image
FROM nginx:alpine

# Remove default Nginx site config (optional)
RUN rm -rf /usr/share/nginx/html/*

# Copy your static site (HTML/CSS/JS/assets) into Nginx's web root
COPY ./ /usr/share/nginx/html

# Expose HTTP port
EXPOSE 80

# Run Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]

