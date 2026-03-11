schema_version = "4.0"
project_name   = "test"

group "test" {
  label = "test"

  service "Amazon API Gateway" "amazon_api_gateway" {
    region      = "us-east-1"
    human_label = "Amazon API Gateway"

    config_group "General" {

      field "Average connection duration Value"  = ""
      field "Average connection rate Value"      = ""
      field "Average message size Value"         = "32"
      field "Average size of each request Value" = "34"
      field "Description - optional"             = "123123"
      field "Messages Value"                     = ""
      field "Requests Value"                     = ""
    }
  }

  service "Amazon S3" "amazon_s3" {
    region      = "us-east-1"
    human_label = "Amazon S3"

    config_group "General" {

      field "Amount of memory allocated to the Lambda function Value"                                                                  = ""
      field "Data Retrievals Value"                                                                                                    = ""
      field "Data retrievals (Bulk) Value"                                                                                             = ""
      field "Data retrievals (Expedited) Value"                                                                                        = ""
      field "Data retrievals (Standard) Value"                                                                                         = ""
      field "Data retrievals Value"                                                                                                    = ""
      field "Data returned by S3 Select Value"                                                                                         = ""
      field "Data scanned by S3 Select Value"                                                                                          = ""
      field "Enter Amount Enter amount"                                                                                                = ""
      field "Filterable metadata (KB) per vector Value"                                                                                = ""
      field "GET request size Value"                                                                                                   = ""
      field "Non-filterable metadata (KB) per vector Value"                                                                            = ""
      field "Number of indexes Enter number of indexes"                                                                                = "1"
      field "PUT/ COPY request size Value"                                                                                             = ""
      field "Percentage of Storage in INT-Archive Access Tier (% of storage that hasn't been accessed for a minimum of 90 days)"       = ""
      field "Percentage of Storage in INT-Archive Instant Access Tier (% of storage that hasn't been accessed in the last 90 days)"    = ""
      field "Percentage of Storage in INT-Deep Archive Access Tier (% of storage that hasn't been accessed for a minimum of 180 days)" = ""
      field "Percentage of Storage in INT-Frequent Access Tier"                                                                        = "100"
      field "Percentage of Storage in INT-Infrequent Access Tier (% of storage that hasn't been accessed in the last 30 days)"         = ""
      field "Percentage of vectors overwritten per month Field value"                                                                  = "16.7"
      field "S3 Batch Operations Jobs Value"                                                                                           = ""
      field "S3 Batch Operations Objects Value"                                                                                        = ""
      field "S3 Express One Zone storage Value"                                                                                        = ""
      field "S3 General Purpose Buckets Value"                                                                                         = "2"
      field "S3 Glacier Deep Archive Average Object Size Value"                                                                        = "16"
      field "S3 Glacier Deep Archive storage Value"                                                                                    = ""
      field "S3 Glacier Flexible Retrieval Average Object Size Value"                                                                  = "16"
      field "S3 Glacier Flexible Retrieval storage Value"                                                                              = ""
      field "S3 Glacier Instant Retrieval storage Value"                                                                               = ""
      field "S3 INT Average Object Size Value"                                                                                         = "16"
      field "S3 INT storage Value"                                                                                                     = ""
      field "S3 Inventory Value"                                                                                                       = ""
      field "S3 Object Tagging Value"                                                                                                  = ""
      field "S3 One Zone-IA storage Value"                                                                                             = ""
      field "S3 Standard storage Value"                                                                                                = ""
      field "S3 Standard-IA storage Value"                                                                                             = ""
      field "S3 Storage Class Analysis Value"                                                                                          = ""
      field "S3 Storage Lens Objects Value"                                                                                            = ""
      field "Size of data returned by S3 Object Lambda Value"                                                                          = ""
      field "Size of encrypted data Value"                                                                                             = ""
      field "Total number of queries per month (across all indexes) Value"                                                             = ""
      field "Vector Dimensions Enter number"                                                                                           = "1024"
    }
  }

  service "AWS Application Migration Service" "aws_application_migration_service" {
    region      = "us-east-1"
    human_label = "AWS Application Migration Service"

    config_group "General" {

      field "Description - optional" = "132123"
    }
  }
}
