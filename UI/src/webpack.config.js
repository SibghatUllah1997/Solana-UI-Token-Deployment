const webpack = require('webpack');
const path = require('path');

module.exports = {
    mode: 'development', // or 'production'
    entry: './src/index.js', // your entry point
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist'),
    },
    resolve: {
        fallback: {
            crypto: require.resolve('crypto-browserify'),
            stream: require.resolve('stream-browserify'),
            assert: require.resolve('assert'),
            os: require.resolve('os-browserify/browser'),
            process: require.resolve('process/browser'),
            buffer: require.resolve('buffer/'),
        },
    },
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process/browser',
            Buffer: ['buffer', 'Buffer'],
        }),
    ],
    module: {
        rules: [
            {
                test: /\.jsx?$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader', // or other loaders if needed
                },
            },
        ],
    },
    devtool: 'inline-source-map', // for easier debugging
};
