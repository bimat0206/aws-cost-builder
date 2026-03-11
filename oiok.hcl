schema_version = "3.0"
project_name   = "oiok"

group "oiok" {
  label = "oiok"

  service "Amazon API Gateway" "amazon_api_gateway" {
    region      = "us-east-1"
    human_label = "Amazon API Gateway"

    dimension "Average connection duration Value"  = ""
    dimension "Average connection rate Value"      = ""
    dimension "Average message size Value"         = "32"
    dimension "Average size of each request Value" = "34"
    dimension "Messages Value"                     = ""
    dimension "Requests Value"                     = ""
  }

  service "Amazon Athena" "amazon_athena" {
    region      = "us-east-1"
    human_label = "Amazon Athena"

    dimension "Amount of data scanned per query Value"  = ""
    dimension "Code execution per session Value"        = ""
    dimension "Length of time capacity is active Value" = ""
    dimension "Total number of queries Value"           = ""
    dimension "Total number of spark sessions Value"    = ""
  }

  service "Amazon CloudWatch" "amazon_cloudwatch" {
    region      = "us-east-1"
    human_label = "Amazon CloudWatch"

    dimension "Description - optional"                                                      = "123123123"
    dimension "Expected Logs Data scanned Value"                                            = ""
    dimension "Infrequent Access Logs Delivered to CloudWatch Logs Value"                   = ""
    dimension "Infrequent Access Logs: Data Ingested Value"                                 = ""
    dimension "Logs Delivered to S3: Data Ingested Value"                                   = ""
    dimension "Mobile sampling rate Enter the amount"                                       = "100"
    dimension "Number of Aurora Capacity Units (ACUs) monitored by Database Insights Value" = ""
    dimension "Number of city-networks to be monitored Value"                               = ""
    dimension "Number of mobile OTEL events and spans or spans per visit Enter the amount"  = "70"
    dimension "Number of monitored resources Value"                                         = ""
    dimension "Number of requests per function Value"                                       = ""
    dimension "Number of vCPUs monitored by Database Insights Value"                        = ""
    dimension "Standard Logs Delivered to CloudWatch Logs Value"                            = ""
    dimension "Standard Logs: Data Ingested Value"                                          = ""
    dimension "Total number of events for DynamoDB Value"                                   = ""
    dimension "Total number of matched log events for CloudWatch Value"                     = ""
    dimension "Volume of incoming requests Value"                                           = ""
    dimension "Volume of outgoing requests to dependencies Value"                           = ""
    dimension "Web sampling rate Enter the amount"                                          = ""
  }

  service "Amazon Data firehose" "amazon_data_firehose" {
    region      = "us-east-1"
    human_label = "Amazon Data firehose"

    dimension "Average ratio of data processed to VPC vs data ingested Enter ratio" = "1.3"
    dimension "Description - optional"                                              = "123123"
    dimension "Number of records for data ingestion Value"                          = ""
    dimension "Record size Value"                                                   = "5"
  }
}
