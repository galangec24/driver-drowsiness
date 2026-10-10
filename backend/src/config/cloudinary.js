const { v2: cloudinary } = require('cloudinary');
const { env } = require('./env');

const configured = Boolean(
  env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret,
);

if (configured) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
}

module.exports = { cloudinary, isCloudinaryConfigured: () => configured };
