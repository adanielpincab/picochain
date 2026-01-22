const GUN = require('gun');
const server = require('http').createServer().listen(8999);
const gun = GUN({
    web: server,
    //multicast: false,
    //localStorage: false,
    //radisk: false
});
