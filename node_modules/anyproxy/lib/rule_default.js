var utils      = require("./util"),
    bodyParser = require("body-parser"),
    path       = require("path"),
    fs         = require("fs"),
    Promise    = require("promise");

var isRootCAFileExists = require("./certMgr.js").isRootCAFileExists(),
    interceptFlag      = false;

//e.g. [ { keyword: 'aaa', local: '/Users/Stella/061739.pdf' } ]
var mapConfig = [],
    configFile = "mapConfig.json";
function saveMapConfig(content,cb){
    new Promise(function(resolve,reject){
        var anyproxyHome = utils.getAnyProxyHome(),
            mapCfgPath   = path.join(anyproxyHome,configFile);

        if(typeof content == "object"){
            content = JSON.stringify(content);
        }
        resolve({
            path    :mapCfgPath,
            content :content
        });
    })
    .then(function(config){
        return new Promise(function(resolve,reject){
            fs.writeFile(config.path, config.content, function(e){
                if(e){
                    reject(e);
                }else{
                    resolve();
                }
            });
        });
    })
    .catch(function(e){
        cb && cb(e);
    })
    .done(function(){
        cb && cb();
    });
}
function getMapConfig(cb){
    var read = Promise.denodeify(fs.readFile);

    new Promise(function(resolve,reject){
        var anyproxyHome = utils.getAnyProxyHome(),
            mapCfgPath   = path.join(anyproxyHome,configFile);

        resolve(mapCfgPath);
    })
    .then(read)
    .then(function(content){
        return JSON.parse(content);
    })
    .catch(function(e){
        cb && cb(e);
    })
    .done(function(obj){
        cb && cb(null,obj);
    });
}

setTimeout(function(){
    //load saved config file
    getMapConfig(function(err,result){
        if(result){
            mapConfig = result;
        }
    });
},1000);


module.exports = {
    token: Date.now(),
    summary:function(){
        var tip = "the default rule for AnyProxy.";
        if(!isRootCAFileExists){
            tip += "\nRoot CA does not exist, will not intercept any https requests.";
        }
        return tip;
    },

    shouldUseLocalResponse : function(req,reqBody){
        //intercept all options request
        var simpleUrl = (req.headers.host || "") + (req.url || "");
        mapConfig.map(function(item){
            var key = item.keyword;
            if(simpleUrl.indexOf(key) >= 0){
                req.anyproxy_map_local = item.local;
                return false;
            }
        });


        return !!req.anyproxy_map_local;
    },

    dealLocalResponse : function(req,reqBody,callback){
        if(req.anyproxy_map_local){
            fs.readFile(req.anyproxy_map_local,function(err,buffer){
                if(err){
                    callback(200, {}, "[AnyProxy failed to load local file] " + err);
                }else{
                    var header = {
                        'Content-Type': utils.contentType(req.anyproxy_map_local)
                    };
                    callback(200, header, buffer);
                }
            });
        }
    },

    replaceRequestProtocol:function(req,protocol){
    },

    replaceRequestOption : function(req,option){
        // 将手机端google的请求改为百度，防止异常
        var newOption = option;
        if(/google/i.test(newOption.headers.host)){
            newOption.hostname = "www.baidu.com";
            newOption.port     = "80";
        }
        return newOption;
    },

    replaceRequestData: function(req,data){
    },

    replaceResponseStatusCode: function(req,res,statusCode){
    },

    replaceResponseHeader: function(req,res,header){
        // 修改json格式的头为html格式， 否则javascript自动跳转脚本不生效
        if(/mp\/profile_ext/i.test(req.url)){ //文章列表 包括html格式和json格式
            header['content-type'] = 'text/html; charset=UTF-8'
        }
        // 修改文章内容的响应头，去掉安全协议，否则注入的<script>setTimeout(function(){window.location.href='url';},sleep_time);</script>js脚本不执行
        else if(/\/s\?__biz=/i.test(req.url) || /mp\/appmsg\/show\?__biz=/i.test(req.url) ){
            delete header['content-security-policy']
            delete header['content-security-policy-report-only']
        }
    },

    // Deprecated
    // replaceServerResData: function(req,res,serverResData){
    //     return serverResData;
    // },

    // replaceServerResDataAsync: function(req,res,serverResData,callback){
    //     callback(serverResData);
    // },
    //自定义
    replaceServerResDataAsync: function(req,res,serverResData,callback){
        try{
            function nextPageCallback(reponse){
                // 修改响应到客户端的数据 实现自动跳转到下个公众号
                if (reponse == "None"){
                    callback(serverResData);
                }else{
                    callback(reponse + serverResData);
                }
            }

            if(/mp\/profile_ext\?action=home/i.test(req.url) || /mp\/profile_ext\?action=getmsg/i.test(req.url)){ //文章列表 包括html格式和json格式
                httpPost(serverResData.toString(), "/wechat/get_article_list", req.url, nextPageCallback);
            }
            else if(/\/s\?__biz=/i.test(req.url) || /mp\/appmsg\/show\?__biz=/i.test(req.url) || /\/mp\/rumor/i.test(req.url)){ //文章内容；mp/appmsg/show?_biz 为2014年老版链接;  mp/rumor 是不详实的文章
                httpPost(serverResData.toString(), "/wechat/get_article_content", req.url, nextPageCallback);
            }
            else if (/mp\/getappmsgext/i.test(req.url)){ // 阅读量 观看量
                httpPost(serverResData.toString(), "/wechat/get_read_watched_count", req.url, nextPageCallback);
            }
            else if (/mp\/appmsg_comment/i.test(req.url)){ // 评论列表
                httpPost(serverResData.toString(), "/wechat/get_comment", req.url, nextPageCallback);
            }
            else{
                // 不是想捕获的数据 直接响应到客户端 不需要修改
                callback(serverResData);
            }

        }catch(e){
            console.log(e);
            callback(serverResData);
        }

    },

    pauseBeforeSendingResponse: function(req,res){
    },

    shouldInterceptHttpsReq:function(req){
        return interceptFlag;
    },

    //[beta]
    //fetch entire traffic data
    fetchTrafficData: function(id,info){},

    setInterceptFlag: function(flag){
        interceptFlag = flag && isRootCAFileExists;
    },

    _plugIntoWebinterface: function(app,cb){

        app.get("/filetree",function(req,res){
            try{
                var root = req.query.root || utils.getUserHome() || "/";
                utils.filewalker(root,function(err, info){
                    res.json(info);
                });
            }catch(e){
                res.end(e);
            }
        });

        app.use(bodyParser.json());
        app.get("/getMapConfig",function(req,res){
            res.json(mapConfig);
        });
        app.post("/setMapConfig",function(req,res){
            mapConfig = req.body;
            res.json(mapConfig);

            saveMapConfig(mapConfig);
        });

        cb();
    },

    _getCustomMenu : function(){
        return [
            // {
            //     name:"test",
            //     icon:"uk-icon-lemon-o",
            //     url :"http://anyproxy.io"
            // }
        ];
    }
};

// 发送数据到自己的服务端
function httpPost(data, actionMethod, reqUrl, callback = "") {
    console.log('发送数据到服务端')
    console.log(reqUrl)

    var http = require('http');
    var data = {
        data:data,
        req_url:reqUrl
    };
    content = require('querystring').stringify(data);
    var options = {
        method: "POST",
        host: "localhost", //注意没有http://，这是服务器的域名。
        port: 6210,
        path: actionMethod, //处理请求的action
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            "Content-Length": content.length
        }
    };
    var req = http.request(options, function (res) {
        res.setEncoding('utf8');
        res.on('data', function (chunk) { // chunk 为假时不触发回调
            console.log('BODY: ' + chunk);

            if (callback){
                callback(chunk)
            }

        });
    });
    req.on('error', function (e) {
        console.log('problem with request: ' + e.message);
    });
    req.write(content);
    req.end();
}